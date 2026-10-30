import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMatchLifecycle } from "@/application/match-lifecycle";
import type { Match } from "@/domain/models";
import type {
  FootballDataProvider,
  ProviderCompetitionSeason,
  ProviderFixture,
  ProviderMatchContext,
  ProviderSquadPlayer,
  ProviderTeamIdentity,
} from "@/domain/ports";
import { AdminFootballSyncStore } from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `fixture-discovery-${Date.now()}`);
const database = getFirestore(app);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("periodic fixture discovery", () => {
  it("discovers an upcoming fixture without changing protected closed-match history", async () => {
    const suffix = String(Date.now());
    const teamId = `team-discovery-${suffix}`;
    const staleMatch = match(teamId, `stale-${suffix}`, {
      status: "live",
      ratingState: "rating_closed",
      kickoffAt: "2026-10-24T02:00:00.000Z",
      votingOpensAt: "2026-10-24T04:00:00.000Z",
      votingClosesAt: "2026-10-24T06:00:00.000Z",
      score: { home: 1, away: 0 },
    });
    const upcoming = match(teamId, `upcoming-${suffix}`, {
      kickoffAt: "2026-11-01T23:00:00.000Z",
    });
    const store = new AdminFootballSyncStore(database);
    await database.doc(`teams/${teamId}`).set({
      displayName: "Tracked Team",
      shortName: "Tracked",
      countryName: "Costa Rica",
      countryCode: "CR",
      brandingKey: "tracked",
      externalProviderId: "815",
      createdAt: Timestamp.fromDate(new Date("2026-01-01T00:00:00.000Z")),
      updatedAt: Timestamp.fromDate(new Date("2026-01-01T00:00:00.000Z")),
    });
    await store.upsertMatches([staleMatch]);
    await store.setSyncMetadata({
      teamId,
      lastFixtureDiscoveryAt: "2026-10-30T01:59:59.000Z",
      updatedAt: "2026-10-30T01:59:59.000Z",
    });
    const protectedPaths = [
      `matches/${staleMatch.id}/verifiedLineups/current`,
      `matches/${staleMatch.id}/verifiedCoachAssignments/head-coach`,
      `matches/${staleMatch.id}/ballots/voter`,
      `matches/${staleMatch.id}/results/summary`,
    ];
    const protectedValues = [
      { evidence: "lineup", participants: ["player-1"] },
      { evidence: "coach", coachId: "coach-1" },
      { voterId: "voter", playerRatings: { "player-1": 8 } },
      { status: "final", ballotCount: 1, mvpPlayerIds: ["player-1"] },
    ];
    await Promise.all(
      protectedPaths.map((path, index) =>
        database.doc(path).set(protectedValues[index]),
      ),
    );

    const result = await runMatchLifecycle({
      teamId,
      store,
      provider: new NoRequestProvider(),
      now: () => new Date("2026-10-30T14:00:00.000Z"),
      discoverFixtures: async () => {
        await store.upsertMatches([upcoming]);
        return { fixtureCount: 1 };
      },
      syncParticipants: async () => {
        throw new Error("Participant synchronization was not expected.");
      },
    });

    expect(result).toMatchObject({
      action: "discovered",
      matchId: upcoming.id,
      providerRequests: 0,
    });
    const persistedStale = await store.getMatch(staleMatch.id);
    expect(persistedStale).toMatchObject({
      status: "live",
      ratingState: "rating_closed",
      votingOpensAt: staleMatch.votingOpensAt,
      votingClosesAt: staleMatch.votingClosesAt,
    });
    await expect(store.getMatch(upcoming.id)).resolves.toMatchObject({
      status: "scheduled",
      ratingState: "not_ready",
    });
    const metadata = await store.getSyncMetadata(teamId);
    expect(metadata?.lastFixtureDiscoveryAt).toBe("2026-10-30T14:00:00.000Z");
    const protectedAfter = await Promise.all(
      protectedPaths.map((path) => database.doc(path).get()),
    );
    expect(protectedAfter.map((snapshot) => snapshot.data())).toEqual(
      protectedValues,
    );
  });
});

class NoRequestProvider implements FootballDataProvider {
  readonly name = "api-football";
  requestCount = 0;

  async resolveTeam(): Promise<ProviderTeamIdentity> {
    throw new Error("Unexpected provider request.");
  }
  async getCompetitionSeasons(): Promise<ProviderCompetitionSeason[]> {
    throw new Error("Unexpected provider request.");
  }
  async getFixtures(): Promise<ProviderFixture[]> {
    throw new Error("Unexpected provider request.");
  }
  async getFixture(): Promise<ProviderFixture> {
    throw new Error("Unexpected provider request.");
  }
  async getMatchContext(): Promise<ProviderMatchContext> {
    throw new Error("Unexpected provider request.");
  }
  async getLineupContext(): Promise<ProviderMatchContext | null> {
    throw new Error("Unexpected provider request.");
  }
  async getSquad(): Promise<ProviderSquadPlayer[]> {
    throw new Error("Unexpected provider request.");
  }
}

function match(teamId: string, id: string, overrides: Partial<Match>): Match {
  return {
    id,
    trackedTeamId: teamId,
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Tracked Team" },
    awayTeam: { externalProviderId: "820", name: "Opponent" },
    kickoffAt: "2026-11-01T23:00:00.000Z",
    status: "scheduled",
    ratingState: "not_ready",
    score: { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: id,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}
