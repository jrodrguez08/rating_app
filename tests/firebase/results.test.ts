import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMatchLifecycle } from "@/application/match-lifecycle";
import type { FootballDataProvider } from "@/domain/ports";
import {
  AdminFootballSyncStore,
  AdminResultService,
} from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `result-tests-${Date.now()}`);
const database = getFirestore(app);
const store = new AdminFootballSyncStore(database);
const reader = new AdminResultService(database);
const close = new Date("2026-08-29T20:00:00.000Z");

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
});
afterAll(() => deleteApp(app));

describe("trusted result finalization", () => {
  it("reveals nothing before close, then atomically stores one stable summary", async () => {
    await seed("two-votes");
    expect(
      (await reader.getPageState("two-votes", new Date(close.getTime() - 1)))
        .state,
    ).toBe("locked");
    await Promise.all([
      writeBallot("two-votes", "voter-a", 8, 6),
      writeBallot("two-votes", "voter-b", 9, 8),
    ]);
    await store.finalizeMatchResult("two-votes", close);
    const first = await database.doc("matches/two-votes/results/summary").get();
    expect(first.data()).toMatchObject({
      ballotCount: 2,
      status: "final",
      mvpPlayerIds: ["starter"],
      playerResults: { starter: { average: 8.5, voteCount: 2 } },
      coachResult: { average: 7, voteCount: 2 },
    });
    expect(first.data()?.generatedAt).toBeInstanceOf(Timestamp);
    expect(
      (await database.doc("matches/two-votes").get()).data()?.ratingState,
    ).toBe("rating_closed");
    await store.finalizeMatchResult(
      "two-votes",
      new Date(close.getTime() + 60_000),
    );
    const second = await database
      .doc("matches/two-votes/results/summary")
      .get();
    expect(second.data()?.generatedAt).toEqual(first.data()?.generatedAt);
    expect((await reader.getPageState("two-votes", close)).state).toBe("ready");
  });

  it("creates an explicit stable zero-vote summary", async () => {
    await seed("zero-votes");
    await store.finalizeMatchResult("zero-votes", close);
    expect(
      (await database.doc("matches/zero-votes/results/summary").get()).data(),
    ).toMatchObject({ ballotCount: 0, status: "no_votes", mvpPlayerIds: [] });
  });

  it("leaves malformed ballots retryable without closing or publishing", async () => {
    await seed("malformed");
    await database.doc("matches/malformed/ballots/voter-a").set({
      matchId: "malformed",
      voterId: "voter-a",
      teamId: "team-1",
      playerRatings: {},
      coachRating: { coachId: "coach-1", rating: 8 },
      submittedAt: Timestamp.fromDate(close),
    });
    await expect(store.finalizeMatchResult("malformed", close)).rejects.toThrow(
      "malformed",
    );
    expect(
      (await database.doc("matches/malformed/results/summary").get()).exists,
    ).toBe(false);
    expect(
      (await database.doc("matches/malformed").get()).data()?.ratingState,
    ).toBe("rating_ready");
  });

  it("finalizes a stranded expired window before a future fixture without provider requests", async () => {
    const matchId = "lifecycle-expired";
    const opensAt = new Date(close.getTime() - 7_200_000);
    await seed(matchId);
    await writeBallot(matchId, "voter-a", 9, 8);
    await database.doc("teams/team-1").set({
      displayName: "Tracked Team",
      shortName: "Tracked",
      countryName: "Costa Rica",
      countryCode: "CR",
      brandingKey: "tracked",
      externalProviderId: "815",
      createdAt: Timestamp.fromDate(opensAt),
      updatedAt: Timestamp.fromDate(opensAt),
    });
    await database.doc("matches/future-fixture").set({
      trackedTeamId: "team-1",
      competitionId: "c",
      seasonId: "s",
      homeTeam: { externalProviderId: "815", name: "Herediano" },
      awayTeam: { externalProviderId: "3", name: "Future opponent" },
      kickoffAt: Timestamp.fromDate(new Date(close.getTime() + 86_400_000)),
      status: "scheduled",
      ratingState: "not_ready",
      score: { home: null, away: null },
      externalProvider: "api-football",
      externalProviderFixtureId: "future-fixture",
      createdAt: Timestamp.fromDate(opensAt),
      updatedAt: Timestamp.fromDate(opensAt),
    });
    const provider = providerThatMustNotRun();

    const result = await runMatchLifecycle({
      teamId: "team-1",
      provider,
      store,
      now: () => close,
      discoverFixtures: async () => {
        throw new Error("Fixture discovery must not run before finalization.");
      },
      syncParticipants: async () => {
        throw new Error("Participant sync must not run before finalization.");
      },
    });
    const finalizedMatch = await database.doc(`matches/${matchId}`).get();
    const summary = await database
      .doc(`matches/${matchId}/results/summary`)
      .get();

    expect(result).toMatchObject({
      action: "rating_closed",
      matchId,
      providerRequests: 0,
    });
    expect(summary.data()).toMatchObject({
      status: "final",
      ballotCount: 1,
    });
    expect(finalizedMatch.data()).toMatchObject({
      ratingState: "rating_closed",
      votingOpensAt: Timestamp.fromDate(opensAt),
      votingClosesAt: Timestamp.fromDate(close),
    });
    expect(provider.requestCount).toBe(0);
  });
});

function providerThatMustNotRun(): FootballDataProvider {
  const unexpected = async (): Promise<never> => {
    throw new Error("Football provider must not run during finalization.");
  };
  return {
    name: "api-football",
    requestCount: 0,
    resolveTeam: unexpected,
    getCompetitionSeasons: unexpected,
    getFixtures: unexpected,
    getFixture: unexpected,
    getMatchContext: unexpected,
  };
}

async function seed(matchId: string) {
  const timestamp = Timestamp.fromDate(close);
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: "team-1",
    competitionId: "c",
    seasonId: "s",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "2", name: "Opponent" },
    kickoffAt: timestamp,
    status: "finished",
    ratingState: "rating_ready",
    score: { home: 2, away: 1 },
    votingOpensAt: Timestamp.fromDate(new Date(close.getTime() - 7_200_000)),
    votingClosesAt: timestamp,
    externalProvider: "api-football",
    externalProviderFixtureId: matchId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc(`matches/${matchId}/participants/starter`).set({
    matchId,
    playerId: "starter",
    teamId: "team-1",
    externalProvider: "api-football",
    externalProviderTeamId: "815",
    externalProviderPlayerId: "1",
    playerName: "Starter",
    position: "Midfielder",
    squadRole: "starter",
    starter: true,
    participated: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc(`matches/${matchId}/coachAssignments/head-coach`).set({
    matchId,
    coachId: "coach-1",
    teamId: "team-1",
    externalProviderTeamId: "815",
    role: "head-coach",
    coachName: "Coach",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
async function writeBallot(
  matchId: string,
  voterId: string,
  player: number,
  coach: number,
) {
  await database.doc(`matches/${matchId}/ballots/${voterId}`).set({
    matchId,
    voterId,
    teamId: "team-1",
    playerRatings: { starter: player },
    coachRating: { coachId: "coach-1", rating: coach },
    submittedAt: Timestamp.fromDate(close),
  });
}
