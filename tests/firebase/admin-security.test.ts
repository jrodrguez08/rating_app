import { randomBytes, scryptSync } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import {
  adminChallengeDocumentId,
  type AdminCoachAction,
} from "@/lib/server/admin-coach-action";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `admin-security-${Date.now()}`);
const database = getFirestore(app);
const store = new AdminSecurityStore(database);
const originalDigest = process.env.ADMIN_PASSPHRASE_SCRYPT;
const passphrase = "owner recovery passphrase 2026";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  const salt = randomBytes(16);
  const digest = scryptSync(passphrase, salt, 32, { N: 16_384, r: 8, p: 1 });
  process.env.ADMIN_PASSPHRASE_SCRYPT = `scrypt$v1$16384$8$1$${salt.toString("base64")}$${digest.toString("base64")}`;
});

afterAll(async () => {
  if (originalDigest === undefined) delete process.env.ADMIN_PASSPHRASE_SCRYPT;
  else process.env.ADMIN_PASSPHRASE_SCRYPT = originalDigest;
  await deleteApp(app);
});

describe("admin action security", () => {
  it("binds one-use challenges to an owner, match, and exact preview", async () => {
    const action = coachAction("match-admin-security");
    const preview = await store.issuePreview("owner-security", action);
    expect((await database.collection("adminActionPreviews").get()).empty).toBe(
      true,
    );
    expect(
      (
        await database
          .collection("adminAudit")
          .where("matchId", "==", action.matchId)
          .get()
      ).empty,
    ).toBe(true);
    await expect(
      store.authorizeAction({
        operatorUid: "owner-security",
        action,
        previewToken: preview.token,
        passphrase: "incorrect passphrase value",
      }),
    ).rejects.toMatchObject({ code: "invalid_passphrase" });
    const challenge = await store.authorizeAction({
      operatorUid: "owner-security",
      action,
      previewToken: preview.token,
      passphrase,
    });
    expect(
      (
        await database
          .doc(
            `adminActionChallenges/${adminChallengeDocumentId(challenge.token)}`,
          )
          .get()
      ).data(),
    ).toMatchObject({
      operatorUid: "owner-security",
      matchId: action.matchId,
    });
  });

  it("locks repeated passphrase failures and persists audit evidence", async () => {
    const action = coachAction("match-admin-lockout");
    const preview = await store.issuePreview("owner-lockout", action);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        store.authorizeAction({
          operatorUid: "owner-lockout",
          action,
          previewToken: preview.token,
          passphrase: "incorrect passphrase value",
        }),
      ).rejects.toMatchObject({ code: "invalid_passphrase" });
    }
    await expect(
      store.authorizeAction({
        operatorUid: "owner-lockout",
        action,
        previewToken: preview.token,
        passphrase,
      }),
    ).rejects.toMatchObject({ code: "too_many_attempts" });
    await store.audit({
      operatorUid: "owner-lockout",
      action: "coach_assignment_passphrase",
      matchId: action.matchId,
      coachId: action.coachId,
      outcome: "rejected",
    });
    expect(
      (await database.collection("adminAudit").get()).docs.some(
        (document) => document.data().matchId === action.matchId,
      ),
    ).toBe(true);
  });
});

function coachAction(matchId: string): AdminCoachAction {
  return {
    matchId,
    trackedTeamId: "club-sport-herediano",
    externalFixtureId: "fixture-security",
    coachId: "coach-security",
    coachName: "Coach Security",
    verificationSource: "https://example.com/evidence",
    verificationReason: "Fixture-specific independent evidence.",
  };
}
