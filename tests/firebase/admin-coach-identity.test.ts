import { createHash } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  coachProviderAliasId,
  proposedCoachProviderAlias,
} from "@/domain/coach-identity";
import { providerEntityId } from "@/domain/player-identity";
import { AdminCoachIdentityService } from "@/lib/firebase/admin-coach-identity";
import { AdminFootballSyncStore } from "@/lib/firebase/server";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import {
  adminCoachIdentityAuditId,
  adminCoachIdentityResourceId,
  hashAdminCoachIdentityAction,
  type AdminCoachIdentityAction,
} from "@/lib/server/admin-coach-identity-action";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `admin-coach-identity-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminCoachIdentityService(database);
const timestamp = Timestamp.fromDate(new Date("2026-10-19T12:00:00.000Z"));

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("admin Coach identity reconciliation", () => {
  it("previews with zero writes and atomically links a late provider Coach", async () => {
    const action = await seedPair("late-provider");
    const before = await counts();

    const preview = await service.preview({
      ...action,
      operatorId: "owner-coach",
    });

    expect(preview).toMatchObject({
      status: "safe",
      canApply: true,
      canonical: { name: "Jafet Soto", verifiedAssignments: 1 },
      duplicate: { name: "J. Soto" },
    });
    expect(await counts()).toEqual(before);

    const token = await seedChallenge(action, "late-provider");
    const first = await service.applyAuthorized(
      { ...action, operatorId: "owner-coach" },
      token,
    );
    const retry = await service.applyAuthorized(
      { ...action, operatorId: "owner-coach" },
      token,
    );

    expect(first.disposition).toBe("committed");
    expect(retry).toMatchObject({
      disposition: "idempotent_retry",
      auditId: first.auditId,
    });
    expect(
      (
        await database
          .doc(
            `coachProviderAliases/${coachProviderAliasId("api-football", externalId("late-provider"))}`,
          )
          .get()
      ).data(),
    ).toMatchObject({ canonicalCoachId: action.canonicalCoachId });
    expect(
      (await database.doc(`coaches/${action.canonicalCoachId}`).get()).data(),
    ).toMatchObject({
      displayName: "Jafet Soto",
      identityProvenance: "operator_verified",
      externalProviderId: externalId("late-provider"),
    });
    expect(
      (
        await database
          .doc(
            `adminAudit/${adminCoachIdentityAuditId(adminChallengeDocumentId(token))}`,
          )
          .get()
      ).data(),
    ).toMatchObject({ outcome: "success", decision: "match" });

    const syncStore = new AdminFootballSyncStore(database);
    const laterAlias = await syncStore.resolveCoachProviderAlias(
      proposedCoachProviderAlias(
        "api-football",
        externalId("late-provider"),
        "2026-10-20T12:00:00.000Z",
      ),
    );
    expect(laterAlias.canonicalCoachId).toBe(action.canonicalCoachId);
    const futureMatchId = "future-late-provider";
    await database.doc(`matches/${futureMatchId}`).set({
      trackedTeamId: "club-sport-herediano",
      externalProvider: "api-football",
      externalProviderFixtureId: "future-fixture",
      ratingState: "not_ready",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await syncStore.replaceMatchParticipantContext(futureMatchId, {
      players: [],
      participants: [],
      coach: {
        id: action.canonicalCoachId,
        displayName: "J. Soto",
        identityProvenance: "provider",
        externalProvider: "api-football",
        externalProviderId: externalId("late-provider"),
        createdAt: "2026-10-20T12:00:00.000Z",
        updatedAt: "2026-10-20T12:00:00.000Z",
      },
      assignment: {
        matchId: futureMatchId,
        coachId: action.canonicalCoachId,
        teamId: "club-sport-herediano",
        externalProviderTeamId: "815",
        role: "head-coach",
        coachName: "J. Soto",
        provenance: "provider",
        createdAt: "2026-10-20T12:00:00.000Z",
        updatedAt: "2026-10-20T12:00:00.000Z",
      },
    });
    expect(
      (await database.doc(`coaches/${action.canonicalCoachId}`).get()).data(),
    ).toMatchObject({
      displayName: "Jafet Soto",
      identityProvenance: "operator_verified",
    });
    expect(
      (
        await database
          .doc(`matches/${futureMatchId}/coachAssignments/head-coach`)
          .get()
      ).data(),
    ).toMatchObject({
      coachId: action.canonicalCoachId,
      coachName: "Jafet Soto",
    });
  });

  it("preserves every assignment, verified record, ballot and result", async () => {
    const action = await seedPair("history-preserved");
    const providerCoachId = action.secondCoachId;
    const matchId = "coach-history-preserved";
    await seedAssociation(matchId, providerCoachId, true);
    await database.doc(`matches/${matchId}/ballots/voter-1`).set({
      matchId,
      teamId: "club-sport-herediano",
      voterId: "voter-1",
      playerRatings: { player: 8 },
      coachRating: { coachId: providerCoachId, rating: 9 },
      submittedAt: timestamp,
    });
    await database.doc(`matches/${matchId}/results/summary`).set({
      matchId,
      teamId: "club-sport-herediano",
      status: "final",
      ballotCount: 1,
      playerResults: {},
      coachResult: {
        coachId: providerCoachId,
        coachName: "J. Soto",
        average: 9,
        voteCount: 1,
      },
      mvpPlayerIds: [],
      generatedAt: timestamp,
    });
    const protectedAction = {
      ...action,
      canonicalCoachId: providerCoachId,
    };
    const paths = [
      `matches/${matchId}/coachAssignments/head-coach`,
      `matches/${matchId}/verifiedCoachAssignments/head-coach`,
      `matches/${matchId}/ballots/voter-1`,
      `matches/${matchId}/results/summary`,
    ];
    const before = await Promise.all(
      paths.map(async (path) => (await database.doc(path).get()).data()),
    );
    const token = await seedChallenge(protectedAction, "history-preserved");

    await service.applyAuthorized(
      { ...protectedAction, operatorId: "owner-coach" },
      token,
    );

    const after = await Promise.all(
      paths.map(async (path) => (await database.doc(path).get()).data()),
    );
    expect(after).toEqual(before);
  });

  it("blocks consolidation when both Coaches have protected voting history", async () => {
    const action = await seedPair("protected-conflict");
    await seedProtectedMatch("protected-manual", action.firstCoachId);
    await seedProtectedMatch("protected-provider", action.secondCoachId);

    await expect(
      service.preview({ ...action, operatorId: "owner-coach" }),
    ).resolves.toMatchObject({
      status: "history_conflict",
      canApply: false,
    });
  });

  it("blocks identities associated with the same fixture", async () => {
    const action = await seedPair("same-fixture");
    await database
      .doc("matches/manual-same-fixture/verifiedCoachAssignments/head-coach")
      .update({ coachId: action.secondCoachId });

    await expect(
      service.preview({ ...action, operatorId: "owner-coach" }),
    ).resolves.toMatchObject({
      status: "history_conflict",
      canApply: false,
      explanation: expect.stringContaining("mismo partido"),
    });
  });

  it("commits one audited decision for concurrent exact applies", async () => {
    const action = await seedPair("concurrent");
    const token = await seedChallenge(action, "concurrent");

    const results = await Promise.all([
      service.applyAuthorized({ ...action, operatorId: "owner-coach" }, token),
      service.applyAuthorized({ ...action, operatorId: "owner-coach" }, token),
    ]);

    expect(results.map(({ disposition }) => disposition).sort()).toEqual([
      "committed",
      "idempotent_retry",
    ]);
    expect(new Set(results.map(({ auditId }) => auditId)).size).toBe(1);
  });

  it("records different people and suppresses the future suggestion", async () => {
    const matchAction = await seedPair("nonmatch", "J. Soto", "José Soto");
    const action = { ...matchAction, decision: "nonmatch" as const };
    const token = await seedChallenge(action, "nonmatch");

    await service.applyAuthorized(
      { ...action, operatorId: "owner-coach" },
      token,
    );

    expect((await service.suggestions()).suggestions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          first: expect.objectContaining({ id: action.firstCoachId }),
          second: expect.objectContaining({ id: action.secondCoachId }),
        }),
      ]),
    );
    expect(
      (
        await database
          .doc(
            `coachProviderAliases/${coachProviderAliasId("api-football", externalId("nonmatch"))}`,
          )
          .get()
      ).exists,
    ).toBe(false);
  });

  it("rejects missing, same, conflicting, and concurrently remapped identities", async () => {
    const action = await seedPair("invalid-cases");
    await expect(
      service.preview({
        ...action,
        secondCoachId: action.firstCoachId,
        operatorId: "owner-coach",
      }),
    ).rejects.toThrow("Seleccione dos directores técnicos distintos");
    await expect(
      service.preview({
        ...action,
        firstCoachId: "coach-missing",
        canonicalCoachId: "coach-missing",
        operatorId: "owner-coach",
      }),
    ).rejects.toThrow("ya no existe");

    await database
      .doc(
        `coachProviderAliases/${coachProviderAliasId("api-football", externalId("invalid-cases"))}`,
      )
      .set({
        canonicalCoachId: "coach-unrelated",
        externalProvider: "api-football",
        externalProviderCoachId: externalId("invalid-cases"),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    await expect(
      service.preview({ ...action, operatorId: "owner-coach" }),
    ).resolves.toMatchObject({
      status: "insufficient_evidence",
      canApply: false,
    });
  });
});

async function seedPair(
  seed: string,
  manualName = "Jafet Soto",
  providerName = "J. Soto",
): Promise<AdminCoachIdentityAction> {
  const manualId = `coach-manual-${seed}`;
  const providerId = providerEntityId(
    "coach",
    "api-football",
    externalId(seed),
  );
  await Promise.all([
    database.doc(`coaches/${manualId}`).set({
      displayName: manualName,
      identityProvenance: "operator_verified",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    database.doc(`coaches/${providerId}`).set({
      displayName: providerName,
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: externalId(seed),
      photoUrl: "https://media.api-sports.io/football/coachs/1.png",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  ]);
  await seedAssociation(`manual-${seed}`, manualId, true);
  await seedAssociation(`provider-${seed}`, providerId, false);
  return {
    firstCoachId: manualId,
    secondCoachId: providerId,
    canonicalCoachId: manualId,
    decision: "match",
  };
}

async function seedAssociation(
  matchId: string,
  coachId: string,
  verified: boolean,
) {
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: "club-sport-herediano",
    ratingState: "not_ready",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc(`matches/${matchId}/coachAssignments/head-coach`).set({
    matchId,
    coachId,
    teamId: "club-sport-herediano",
    externalProviderTeamId: "815",
    role: "head-coach",
    coachName: "Coach",
    provenance: verified ? "operator_verified" : "provider",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (verified) {
    await database
      .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
      .set({
        matchId,
        trackedTeamId: "club-sport-herediano",
        externalProvider: "api-football",
        externalFixtureId: `fixture-${matchId}`,
        coachId,
        verificationSource: "authenticated-owner",
        verificationReason: "Owner confirmed",
        operatorId: "owner-coach",
        provenance: "operator_verified",
        verifiedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
  }
}

async function seedProtectedMatch(matchId: string, coachId: string) {
  await seedAssociation(matchId, coachId, false);
  await database
    .doc(`matches/${matchId}`)
    .update({ ratingState: "rating_ready" });
  await database.doc(`matches/${matchId}/ballots/voter`).set({
    coachRating: { coachId, rating: 8 },
  });
}

async function seedChallenge(action: AdminCoachIdentityAction, seed: string) {
  const token = createHash("sha256").update(seed).digest("base64url");
  await database
    .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
    .set({
      operatorUid: "owner-coach",
      resourceId: adminCoachIdentityResourceId(action),
      actionHash: hashAdminCoachIdentityAction(action),
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
  return token;
}

function externalId(seed: string) {
  return String(
    800_000 +
      [...seed].reduce(
        (total, character) => total + character.charCodeAt(0),
        0,
      ),
  );
}

async function counts() {
  const collections = [
    "coachProviderAliases",
    "coachIdentityReviews",
    "adminActionChallenges",
    "adminAudit",
  ];
  return Promise.all(
    collections.map(async (collection) =>
      Number(
        (await database.collection(collection).count().get()).data().count,
      ),
    ),
  );
}
