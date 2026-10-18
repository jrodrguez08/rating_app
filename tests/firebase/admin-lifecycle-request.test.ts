import { randomBytes } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminLifecycleRejectedError,
  AdminLifecycleService,
  type AdminLifecycleInput,
} from "@/lib/firebase/admin-lifecycle";
import { hashAdminLifecycleAction } from "@/lib/server/admin-lifecycle-action";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `admin-lifecycle-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminLifecycleService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("owner lifecycle request persistence", () => {
  it("binds, rate limits, and consumes one concurrent request without opening voting", async () => {
    const suffix = `${Date.now()}`;
    const matchId = `match-admin-lifecycle-${suffix}`;
    const teamId = `team-admin-lifecycle-${suffix}`;
    const input = await seedMatch(matchId, teamId);

    await expect(service.preview(input)).resolves.toMatchObject({
      matchId,
      confirmedStarters: 11,
      headCoachReady: true,
      lineupProvenance: "provider",
    });

    const token = randomBytes(32).toString("base64url");
    await seedChallenge(input, token);
    const results = await Promise.all([
      service.applyAuthorized(input, token),
      service.applyAuthorized(input, token),
    ]);
    expect(results.map(({ disposition }) => disposition).sort()).toEqual([
      "committed",
      "idempotent_retry",
    ]);
    expect(results[0].receipt).toMatchObject({
      status: "requested",
      requestAttempts: 0,
      providerExecutions: 0,
    });

    const claims = await Promise.all([
      service.claimExecution(input, token),
      service.claimExecution(input, token),
    ]);
    expect(claims.filter((claim) => claim.execute)).toHaveLength(1);
    expect(claims.filter((claim) => !claim.execute)).toHaveLength(1);

    const match = (await database.doc(`matches/${matchId}`).get()).data();
    expect(match?.lastLifecycleRequestedAt).toBeDefined();
    expect(match?.ratingState).toBe("not_ready");
    expect(match).not.toHaveProperty("votingOpensAt");

    const secondToken = randomBytes(32).toString("base64url");
    await seedChallenge(input, secondToken);
    await expect(service.applyAuthorized(input, secondToken)).rejects.toThrow(
      "rate limit",
    );
  });

  it("reconciles a busy request against the same lifecycle attempt", async () => {
    const suffix = `${Date.now()}-busy`;
    const input = await seedMatch(
      `match-admin-lifecycle-${suffix}`,
      `team-admin-lifecycle-${suffix}`,
    );
    const token = randomBytes(32).toString("base64url");
    await seedChallenge(input, token);
    await service.applyAuthorized(input, token);
    const claim = await service.claimExecution(input, token);
    expect(claim.execute).toBe(true);
    if (!claim.execute) throw new Error("Expected an execution claim.");
    const activeAttempt = `scheduled-${suffix}`;
    await database.doc(`footballSyncMetadata/${input.trackedTeamId}`).set({
      teamId: input.trackedTeamId,
      lifecycleAttemptId: activeAttempt,
      lifecycleMatchId: input.matchId,
      lifecycleLeaseUntil: Timestamp.fromMillis(Date.now() + 60_000),
      lastLifecycleStartedAt: Timestamp.now(),
      lastLifecycleTrigger: "scheduled",
    });
    const busy = await service.recordExecutionOutcome(
      input,
      token,
      claim.requestAttemptId,
      {
        action: "idle",
        providerRequests: 0,
        executionStatus: "skipped_busy",
        activeExecution: {
          status: "busy",
          attemptId: activeAttempt,
          matchId: input.matchId,
          leaseUntil: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    );
    expect(busy).toMatchObject({ status: "skipped_busy", retryable: true });
    await database.doc(`footballSyncMetadata/${input.trackedTeamId}`).update({
      lifecycleAttemptId: FieldValue.delete(),
      lifecycleMatchId: FieldValue.delete(),
      lifecycleLeaseUntil: FieldValue.delete(),
      lastLifecycleAttemptId: activeAttempt,
      lastLifecycleMatchId: input.matchId,
      lastLifecycleAction: "refreshed",
      lastLifecycleProviderRequests: 1,
    });

    await expect(
      service.inspectAuthorized(input, token),
    ).resolves.toMatchObject({
      status: "completed",
      lifecycleAction: "refreshed",
      providerRequests: 1,
      retryable: false,
    });
  });

  it("retries a transient post-commit failure without creating another audit", async () => {
    const suffix = `${Date.now()}-retry`;
    const input = await seedMatch(
      `match-admin-lifecycle-${suffix}`,
      `team-admin-lifecycle-${suffix}`,
    );
    const token = randomBytes(32).toString("base64url");
    await seedChallenge(input, token);
    const commit = await service.applyAuthorized(input, token);
    const first = await service.claimExecution(input, token);
    if (!first.execute) throw new Error("Expected the first execution claim.");
    await expect(
      service.recordExecutionFailure(input, token, first.requestAttemptId),
    ).resolves.toMatchObject({ status: "failed", retryable: true });
    await database
      .doc(`adminLifecycleRequests/${commit.receipt.auditId}`)
      .update({
        nextAttemptAt: Timestamp.fromMillis(Date.now() - 1_000),
      });
    const retry = await service.claimExecution(input, token);
    if (!retry.execute) throw new Error("Expected the retry execution claim.");
    await expect(
      service.recordExecutionOutcome(input, token, retry.requestAttemptId, {
        action: "refreshed",
        matchId: input.matchId,
        providerRequests: 1,
        executionStatus: "completed",
      }),
    ).resolves.toMatchObject({
      status: "completed",
      requestAttempts: 2,
      providerExecutions: 2,
      retryable: false,
    });
    const audits = await database
      .collection("adminAudit")
      .where("matchId", "==", input.matchId)
      .get();
    expect(audits.size).toBe(1);
  });

  it("recovers a lost response from execution metadata and preserves exact replay", async () => {
    const suffix = `${Date.now()}-lost-response`;
    const input = await seedMatch(
      `match-admin-lifecycle-${suffix}`,
      `team-admin-lifecycle-${suffix}`,
    );
    const token = randomBytes(32).toString("base64url");
    await seedChallenge(input, token);
    const commit = await service.applyAuthorized(input, token);
    const claim = await service.claimExecution(input, token);
    if (!claim.execute) throw new Error("Expected an execution claim.");
    await database.doc(`footballSyncMetadata/${input.trackedTeamId}`).set({
      teamId: input.trackedTeamId,
      lastLifecycleAttemptId: claim.requestAttemptId,
      lastLifecycleMatchId: input.matchId,
      lastLifecycleAction: "refreshed",
      lastLifecycleProviderRequests: 1,
      lastLifecycleCompletedAt: Timestamp.now(),
    });

    await expect(
      service.inspectAuthorized(input, token),
    ).resolves.toMatchObject({
      status: "completed",
      providerExecutions: 1,
      providerRequests: 1,
      retryable: false,
    });
    await expect(service.applyAuthorized(input, token)).resolves.toMatchObject({
      disposition: "idempotent_retry",
      receipt: {
        auditId: commit.receipt.auditId,
        status: "completed",
      },
    });
    const replays = await Promise.all([
      service.claimExecution(input, token),
      service.claimExecution(input, token),
    ]);
    expect(replays.every((replay) => !replay.execute)).toBe(true);
    expect(
      replays.every((replay) => replay.receipt.status === "completed"),
    ).toBe(true);
  });

  it("rejects a mismatched fixture before issuing a request", async () => {
    const suffix = `${Date.now()}-binding`;
    const input = await seedMatch(
      `match-admin-lifecycle-${suffix}`,
      `team-admin-lifecycle-${suffix}`,
    );
    await expect(
      service.preview({ ...input, externalFixtureId: "wrong-fixture" }),
    ).rejects.toBeInstanceOf(AdminLifecycleRejectedError);
  });

  it("rejects an expired unused challenge", async () => {
    const suffix = `${Date.now()}-expired`;
    const input = await seedMatch(
      `match-admin-lifecycle-${suffix}`,
      `team-admin-lifecycle-${suffix}`,
    );
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    await database
      .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
      .set({
        operatorUid: input.operatorId,
        matchId: input.matchId,
        actionHash: hashAdminLifecycleAction(input),
        createdAt: Timestamp.fromMillis(now.getTime() - 3 * 60 * 1000),
        expiresAt: Timestamp.fromMillis(now.getTime() - 60 * 1000),
      });

    await expect(service.applyAuthorized(input, token)).rejects.toBeInstanceOf(
      AdminLifecycleRejectedError,
    );
  });
});

async function seedMatch(
  matchId: string,
  teamId: string,
): Promise<AdminLifecycleInput> {
  const now = new Date();
  const fixtureId = `fixture-${matchId}`;
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: teamId,
    competitionId: "competition-test",
    seasonId: "season-test",
    homeTeam: { externalProviderId: "815", name: "Tracked" },
    awayTeam: { externalProviderId: "2000", name: "Opponent" },
    kickoffAt: Timestamp.fromMillis(now.getTime() - 90 * 60 * 1000),
    status: "live",
    ratingState: "not_ready",
    score: { home: 1, away: 0 },
    lineupSnapshotAt: Timestamp.fromMillis(now.getTime() - 30 * 60 * 1000),
    externalProvider: "api-football",
    externalProviderFixtureId: fixtureId,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
  for (let index = 0; index < 11; index += 1) {
    await database.doc(`matches/${matchId}/participants/player-${index}`).set({
      matchId,
      playerId: `player-${index}`,
      teamId,
      externalProviderTeamId: "815",
      playerName: `Player ${index}`,
      squadRole: "starter",
      starter: true,
      participated: true,
      participationStatus: "confirmed_starter",
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    });
  }
  await database.doc(`matches/${matchId}/coachAssignments/head-coach`).set({
    matchId,
    coachId: "coach-test",
    teamId,
    externalProviderTeamId: "815",
    role: "head-coach",
    coachName: "Coach Test",
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
  return {
    matchId,
    trackedTeamId: teamId,
    externalFixtureId: fixtureId,
    operatorId: "owner-test",
  };
}

async function seedChallenge(input: AdminLifecycleInput, token: string) {
  const now = new Date();
  await database
    .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
    .set({
      operatorUid: input.operatorId,
      matchId: input.matchId,
      actionHash: hashAdminLifecycleAction(input),
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromMillis(now.getTime() + 2 * 60 * 1000),
    });
}
