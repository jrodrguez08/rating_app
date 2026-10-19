import { createHash } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminVerifiedCoachAssignmentCommitError,
  AdminVerifiedCoachAssignmentRejectedError,
  AdminVerifiedCoachService,
  type VerifiedCoachAssignmentInput,
} from "@/lib/firebase/server";
import {
  adminChallengeDocumentId,
  adminCoachAssignmentAuditId,
  hashAdminCoachAction,
} from "@/lib/server/admin-coach-action";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `verified-coach-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminVerifiedCoachService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});
afterAll(() => deleteApp(app));

describe("verified coach assignment persistence", () => {
  it.each(["scheduled", "live"] as const)(
    "permits guarded fixture coach preparation while provider status is %s",
    async (status) => {
      const matchId = `verified-coach-${status}`;
      await seedMatch(matchId);
      await database.doc(`matches/${matchId}`).update({ status });
      const input = assignmentInput(matchId);
      const token = challengeToken(`coach-${status}`);
      await seedChallenge(input, token);

      await expect(
        service.assignAuthorized(input, token),
      ).resolves.toMatchObject({
        disposition: "committed",
      });
      expect(
        (await database.doc(`matches/${matchId}`).get()).data(),
      ).toMatchObject({
        status,
        ratingState: "preparing_rating",
      });
    },
  );
  it("dry-runs without writes, applies idempotently, and rejects conflicts", async () => {
    const matchId = "verified-coach-dry-run";
    await seedMatch(matchId);
    const input = assignmentInput(matchId);

    await expect(service.assign(input, false)).resolves.toMatchObject({
      matchId,
      coachCreated: true,
      assignmentCreated: true,
    });
    expect((await database.doc(`coaches/coach-${matchId}`).get()).exists).toBe(
      false,
    );
    expect(
      (
        await database
          .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
          .get()
      ).exists,
    ).toBe(false);

    await expect(service.assign(input, true)).resolves.toMatchObject({
      coachCreated: true,
      assignmentCreated: true,
    });
    await expect(service.assign(input, true)).resolves.toMatchObject({
      coachCreated: false,
      assignmentCreated: false,
    });
    expect(
      (
        await database
          .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
          .get()
      ).data(),
    ).toMatchObject({
      trackedTeamId: "team-verified",
      externalFixtureId: "fixture-1",
      coachId: `coach-${matchId}`,
      provenance: "operator_verified",
      verificationSource: "https://example.com/match-report",
    });
    expect(
      (
        await database
          .doc(`matches/${matchId}/coachAssignments/head-coach`)
          .get()
      ).data(),
    ).toMatchObject({
      matchId,
      teamId: "team-verified",
      externalProviderTeamId: "815",
      coachId: `coach-${matchId}`,
      coachName: "Verified Coach",
      role: "head-coach",
      provenance: "operator_verified",
    });
    await expect(
      service.assign({ ...input, coachId: "other-coach" }, true),
    ).rejects.toThrow(/conflicts/i);
  });

  it("serializes concurrent identical applies", async () => {
    const matchId = "verified-coach-concurrent";
    await seedMatch(matchId);
    await expect(
      Promise.all([
        service.assign(assignmentInput(matchId), true),
        service.assign(assignmentInput(matchId), true),
      ]),
    ).resolves.toHaveLength(2);
    expect(
      (
        await database
          .collection(`matches/${matchId}/verifiedCoachAssignments`)
          .get()
      ).size,
    ).toBe(1);
  });

  it("repairs a legacy verified-only coach without replacing its evidence", async () => {
    const matchId = "verified-coach-legacy-materialization";
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    const now = Timestamp.now();
    await Promise.all([
      database.doc(`coaches/${input.coachId}`).set({
        displayName: input.coachName,
        identityProvenance: "operator_verified",
        createdAt: now,
        updatedAt: now,
      }),
      database
        .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
        .set({
          matchId,
          trackedTeamId: input.trackedTeamId,
          externalProvider: "api-football",
          externalFixtureId: input.externalFixtureId,
          coachId: input.coachId,
          verificationSource: input.verificationSource,
          verificationReason: input.verificationReason,
          operatorId: input.operatorId,
          provenance: "operator_verified",
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
    ]);
    const evidenceBefore = (
      await database
        .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
        .get()
    ).data();

    await expect(service.assign(input, true)).resolves.toMatchObject({
      coachCreated: false,
      assignmentCreated: true,
    });
    expect(
      (
        await database
          .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
          .get()
      ).data(),
    ).toEqual(evidenceBefore);
    expect(
      (
        await database
          .doc(`matches/${matchId}/coachAssignments/head-coach`)
          .get()
      ).data(),
    ).toMatchObject({
      coachId: input.coachId,
      provenance: "operator_verified",
    });
  });

  it("atomically commits an authorized assignment, challenge, and success audit", async () => {
    const matchId = "verified-coach-atomic";
    const token = challengeToken("atomic");
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    await seedChallenge(input, token);

    await expect(service.assignAuthorized(input, token)).resolves.toMatchObject(
      {
        disposition: "committed",
        plan: { matchId, coachCreated: true, assignmentCreated: true },
      },
    );

    const challengeId = adminChallengeDocumentId(token);
    const auditId = adminCoachAssignmentAuditId(challengeId);
    expect(
      (await database.doc(`adminActionChallenges/${challengeId}`).get()).data(),
    ).toMatchObject({ committedAuditId: auditId });
    expect(
      (await database.doc(`adminAudit/${auditId}`).get()).data(),
    ).toMatchObject({
      operatorUid: input.operatorId,
      action: "coach_assignment_apply",
      matchId,
      trackedTeamId: input.trackedTeamId,
      externalFixtureId: input.externalFixtureId,
      coachId: input.coachId,
      coachName: input.coachName,
      outcome: "success",
      coachCreated: true,
      assignmentCreated: true,
    });
  });

  it("rolls back assignment writes when the success audit cannot be created", async () => {
    const matchId = "verified-coach-audit-failure";
    const token = challengeToken("audit-failure");
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    await seedChallenge(input, token);
    const challengeId = adminChallengeDocumentId(token);
    const auditId = adminCoachAssignmentAuditId(challengeId);
    await database.doc(`adminAudit/${auditId}`).set({ injectedConflict: true });

    await expect(service.assignAuthorized(input, token)).rejects.toBeInstanceOf(
      AdminVerifiedCoachAssignmentCommitError,
    );
    expect((await database.doc(`coaches/${input.coachId}`).get()).exists).toBe(
      false,
    );
    expect(
      (
        await database
          .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (await database.doc(`adminActionChallenges/${challengeId}`).get()).data(),
    ).not.toHaveProperty("consumedAt");
  });

  it("does not write a success audit when assignment validation fails", async () => {
    const matchId = "verified-coach-assignment-failure";
    const token = challengeToken("assignment-failure");
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    await seedChallenge(input, token);
    await database
      .doc(`matches/${matchId}/coachAssignments/head-coach`)
      .set({ coachId: "conflicting-coach", provenance: "provider" });

    await expect(service.assignAuthorized(input, token)).rejects.toBeInstanceOf(
      AdminVerifiedCoachAssignmentRejectedError,
    );
    const challengeId = adminChallengeDocumentId(token);
    expect(
      (
        await database
          .doc(`adminAudit/${adminCoachAssignmentAuditId(challengeId)}`)
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (await database.doc(`adminActionChallenges/${challengeId}`).get()).data(),
    ).not.toHaveProperty("consumedAt");
  });

  it("returns the committed receipt for repeat and ambiguous-response retries", async () => {
    const matchId = "verified-coach-retry";
    const token = challengeToken("retry");
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    await seedChallenge(input, token);

    const committed = await service.assignAuthorized(input, token);
    const retried = await service.assignAuthorized(input, token);

    expect(retried).toEqual({
      ...committed,
      disposition: "idempotent_retry",
    });
    expect(
      (
        await database
          .collection("adminAudit")
          .where("matchId", "==", matchId)
          .get()
      ).size,
    ).toBe(1);
  });

  it("serializes concurrent requests using one challenge and one audit", async () => {
    const matchId = "verified-coach-authorized-concurrent";
    const token = challengeToken("authorized-concurrent");
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    await seedChallenge(input, token);

    const results = await Promise.all([
      service.assignAuthorized(input, token),
      service.assignAuthorized(input, token),
    ]);

    expect(results.map((result) => result.disposition).sort()).toEqual([
      "committed",
      "idempotent_retry",
    ]);
    expect(
      (
        await database
          .collection("adminAudit")
          .where("matchId", "==", matchId)
          .get()
      ).size,
    ).toBe(1);
  });

  it.each([
    ["rating_ready", { ratingState: "rating_ready" }],
    [
      "an open voting window",
      {
        ratingState: "rating_open",
        votingOpensAt: new Date("2026-10-11T22:01:00.000Z"),
        votingClosesAt: new Date("2026-10-12T00:01:00.000Z"),
      },
    ],
    ["rating_closed", { ratingState: "rating_closed" }],
  ])("recovers the original receipt after %s", async (suffix, matchUpdate) => {
    const matchId = `verified-coach-receipt-${suffix.replaceAll(" ", "-")}`;
    const { committed, input, token } = await commitAuthorized(matchId);
    await database.doc(`matches/${matchId}`).update(matchUpdate);

    await expect(service.assignAuthorized(input, token)).resolves.toEqual({
      ...committed,
      disposition: "idempotent_retry",
    });
  });

  it("recovers the original receipt after ballots and immutable results exist without mutating them", async () => {
    const matchId = "verified-coach-receipt-finalized";
    const { committed, input, token } = await commitAuthorized(matchId);
    const participantPath = `matches/${matchId}/participants/player-1`;
    const assignmentPath = `matches/${matchId}/verifiedCoachAssignments/head-coach`;
    const ballotPath = `matches/${matchId}/ballots/voter-1`;
    const resultPath = `matches/${matchId}/results/summary`;
    await Promise.all([
      database.doc(`matches/${matchId}`).update({
        ratingState: "rating_closed",
        votingOpensAt: new Date("2026-10-11T22:01:00.000Z"),
        votingClosesAt: new Date("2026-10-12T00:01:00.000Z"),
      }),
      database.doc(participantPath).set({
        participantId: "player-1",
        participated: true,
      }),
      database.doc(ballotPath).set({ ratings: { "player-1": 8 } }),
      database.doc(resultPath).set({ generatedAt: "immutable-result" }),
    ]);
    const protectedPaths = [
      `matches/${matchId}`,
      participantPath,
      `coaches/${input.coachId}`,
      assignmentPath,
      ballotPath,
      resultPath,
      `adminActionChallenges/${adminChallengeDocumentId(token)}`,
      `adminAudit/${committed.auditId}`,
    ];
    const before = await readDocuments(protectedPaths);

    await expect(service.assignAuthorized(input, token)).resolves.toEqual({
      ...committed,
      disposition: "idempotent_retry",
    });

    expect(await readDocuments(protectedPaths)).toEqual(before);
    expect(
      (
        await database
          .collection("adminAudit")
          .where("matchId", "==", matchId)
          .get()
      ).size,
    ).toBe(1);
  });

  it("recovers a committed receipt after its consumed challenge expires", async () => {
    const matchId = "verified-coach-receipt-expired";
    const { committed, input, token } = await commitAuthorized(matchId);
    await database
      .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
      .update({ expiresAt: Timestamp.fromMillis(0) });

    await expect(service.assignAuthorized(input, token)).resolves.toEqual({
      ...committed,
      disposition: "idempotent_retry",
    });
  });

  it("fails closed for missing or inconsistent committed receipt evidence", async () => {
    const missingMatchId = "verified-coach-receipt-missing-audit";
    const missing = await commitAuthorized(missingMatchId);
    const missingChallengeId = adminChallengeDocumentId(missing.token);
    await database
      .doc(`adminAudit/${adminCoachAssignmentAuditId(missingChallengeId)}`)
      .delete();
    await expect(
      service.assignAuthorized(missing.input, missing.token),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);

    const mismatchMatchId = "verified-coach-receipt-mismatched-audit";
    const mismatch = await commitAuthorized(mismatchMatchId);
    await database
      .doc(
        `adminAudit/${adminCoachAssignmentAuditId(adminChallengeDocumentId(mismatch.token))}`,
      )
      .update({ externalFixtureId: "different-fixture" });
    await expect(
      service.assignAuthorized(mismatch.input, mismatch.token),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);

    const idMismatchMatchId = "verified-coach-receipt-mismatched-id";
    const idMismatch = await commitAuthorized(idMismatchMatchId);
    await database
      .doc(
        `adminActionChallenges/${adminChallengeDocumentId(idMismatch.token)}`,
      )
      .update({ committedAuditId: "different-audit" });
    await expect(
      service.assignAuthorized(idMismatch.input, idMismatch.token),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);
  });

  it("rejects forged challenges and modified committed actions", async () => {
    const matchId = "verified-coach-receipt-forgery";
    const { input, token } = await commitAuthorized(matchId);
    await expect(
      service.assignAuthorized(input, challengeToken("forged")),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);
    await expect(
      service.assignAuthorized(
        { ...input, externalFixtureId: "different-fixture" },
        token,
      ),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);
    await expect(
      service.assignAuthorized(
        { ...input, trackedTeamId: "different-team" },
        token,
      ),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);
    await expect(
      service.assignAuthorized({ ...input, matchId: "different-match" }, token),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);
    await expect(
      service.assignAuthorized(
        { ...input, operatorId: "different-owner@example.com" },
        token,
      ),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);
    await expect(
      service.assignAuthorized(
        { ...input, verificationReason: "Different valid evidence reason." },
        token,
      ),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);
  });

  it("returns consistent read-only receipts for concurrent exact retries", async () => {
    const matchId = "verified-coach-receipt-concurrent";
    const { committed, input, token } = await commitAuthorized(matchId);
    await database.doc(`matches/${matchId}`).update({
      ratingState: "rating_closed",
    });

    const retries = await Promise.all([
      service.assignAuthorized(input, token),
      service.assignAuthorized(input, token),
      service.assignAuthorized(input, token),
    ]);

    expect(retries).toEqual(
      Array.from({ length: 3 }, () => ({
        ...committed,
        disposition: "idempotent_retry",
      })),
    );
    expect(
      (
        await database
          .collection("adminAudit")
          .where("matchId", "==", matchId)
          .get()
      ).size,
    ).toBe(1);
  });

  it("rejects a new authorized mutation after voting opens", async () => {
    const matchId = "verified-coach-new-during-voting";
    const token = challengeToken("new-during-voting");
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    await seedChallenge(input, token);
    await database.doc(`matches/${matchId}`).update({
      ratingState: "rating_open",
      votingOpensAt: new Date("2026-10-11T22:01:00.000Z"),
      votingClosesAt: new Date("2026-10-12T00:01:00.000Z"),
    });

    await expect(service.assignAuthorized(input, token)).rejects.toBeInstanceOf(
      AdminVerifiedCoachAssignmentRejectedError,
    );
    expect(
      (
        await database
          .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
          .get()
      ).exists,
    ).toBe(false);
  });

  it("rejects expired, wrong-owner, wrong-match, and replayed challenges", async () => {
    const cases = [
      { suffix: "expired", overrides: { expiresAt: Timestamp.fromMillis(0) } },
      { suffix: "owner", overrides: { operatorUid: "other-owner" } },
      { suffix: "match", overrides: { matchId: "other-match" } },
    ];
    for (const testCase of cases) {
      const matchId = `verified-coach-challenge-${testCase.suffix}`;
      const token = challengeToken(testCase.suffix);
      await seedMatch(matchId);
      const input = assignmentInput(matchId);
      await seedChallenge(input, token, testCase.overrides);
      await expect(
        service.assignAuthorized(input, token),
      ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);
      expect(
        (
          await database
            .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
            .get()
        ).exists,
      ).toBe(false);
    }

    const matchId = "verified-coach-replay-different-action";
    const token = challengeToken("replay-different-action");
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    await seedChallenge(input, token);
    await service.assignAuthorized(input, token);
    await expect(
      service.assignAuthorized(
        { ...input, coachId: "different-coach", coachName: "Different Coach" },
        token,
      ),
    ).rejects.toBeInstanceOf(AdminVerifiedCoachAssignmentRejectedError);
    expect((await database.doc("coaches/different-coach").get()).exists).toBe(
      false,
    );
  });

  it("rejects wrong bindings, malformed evidence, ballots, and finalized results", async () => {
    const matchId = "verified-coach-invalid";
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    await expect(
      service.assign({ ...input, trackedTeamId: "wrong-team" }, false),
    ).rejects.toThrow(/Team or fixture/i);
    await expect(
      service.assign({ ...input, externalFixtureId: "wrong-fixture" }, false),
    ).rejects.toThrow(/Team or fixture/i);
    await expect(
      service.assign(
        { ...input, verificationSource: "http://example.com" },
        false,
      ),
    ).rejects.toThrow(/input is invalid/i);

    await database.doc(`matches/${matchId}/ballots/voter`).set({ any: true });
    await expect(service.assign(input, false)).rejects.toThrow(
      /not permitted/i,
    );
    await database.doc(`matches/${matchId}/ballots/voter`).delete();
    await database
      .doc(`matches/${matchId}/resultRevisions/reopen-1`)
      .set({ any: true });
    await expect(service.assign(input, false)).rejects.toThrow(
      /not permitted/i,
    );
    await database.doc(`matches/${matchId}/resultRevisions/reopen-1`).delete();
    await database.doc(`matches/${matchId}/results/summary`).set({ any: true });
    await expect(service.assign(input, false)).rejects.toThrow(
      /not permitted/i,
    );
  });
});

function assignmentInput(matchId: string): VerifiedCoachAssignmentInput {
  return {
    matchId,
    trackedTeamId: "team-verified",
    externalFixtureId: "fixture-1",
    coachId: `coach-${matchId}`,
    coachName: "Verified Coach",
    verificationSource: "https://example.com/match-report",
    verificationReason: "Independent fixture-specific match report.",
    operatorId: "operator@example.com",
  };
}

function challengeToken(seed: string): string {
  return createHash("sha256").update(seed).digest("base64url");
}

async function seedChallenge(
  input: VerifiedCoachAssignmentInput,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  await database
    .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
    .set({
      operatorUid: input.operatorId,
      matchId: input.matchId,
      actionHash: hashAdminCoachAction(input),
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 120_000),
      ...overrides,
    });
}

async function commitAuthorized(matchId: string) {
  const token = challengeToken(matchId);
  await seedMatch(matchId);
  const input = assignmentInput(matchId);
  await seedChallenge(input, token);
  const committed = await service.assignAuthorized(input, token);
  return { committed, input, token };
}

async function readDocuments(paths: string[]) {
  return Promise.all(
    paths.map(async (path) => (await database.doc(path).get()).data()),
  );
}

async function seedMatch(matchId: string) {
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: "team-verified",
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Tracked" },
    awayTeam: { externalProviderId: "900", name: "Opponent" },
    kickoffAt: new Date("2026-10-11T20:00:00.000Z"),
    status: "finished",
    ratingState: "preparing_rating",
    score: { home: 1, away: 0 },
    externalProvider: "api-football",
    externalProviderFixtureId: "fixture-1",
    createdAt: new Date("2026-10-11T00:00:00.000Z"),
    updatedAt: new Date("2026-10-11T22:00:00.000Z"),
  });
}
