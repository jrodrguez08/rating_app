import { randomBytes } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
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
