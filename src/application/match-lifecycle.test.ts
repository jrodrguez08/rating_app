import { describe, expect, it } from "vitest";

import type { FootballSyncMetadata, Match, Team } from "@/domain/models";
import type {
  FootballDataProvider,
  MatchLifecycleStore,
  ProviderCompetitionSeason,
  ProviderFixture,
  ProviderMatchContext,
  ProviderTeamIdentity,
} from "@/domain/ports";

import { runMatchLifecycle, selectRelevantMatch } from "./match-lifecycle";

const NOW = new Date("2026-08-29T18:00:00.000Z");
const counts = { created: 0, updated: 0, unchanged: 0 };

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: "match-1",
    trackedTeamId: "tracked-team",
    competitionId: "competition-1",
    seasonId: "season-1",
    homeTeam: { externalProviderId: "815", name: "Tracked" },
    awayTeam: { externalProviderId: "2000", name: "Opponent" },
    kickoffAt: "2026-08-29T20:00:00.000Z",
    status: "scheduled",
    ratingState: "not_ready",
    score: { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: "5001",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

class MemoryStore implements MatchLifecycleStore {
  team: Team = {
    id: "tracked-team",
    displayName: "Tracked",
    shortName: "Tracked",
    countryName: "Costa Rica",
    countryCode: "CR",
    brandingKey: "tracked",
    externalProviderId: "815",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  metadata: FootballSyncMetadata | null = {
    teamId: "tracked-team",
    lastFixtureDiscoveryAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  participantCount = 11;
  hasCoach = true;

  constructor(public matches: Match[]) {}
  async getTeam() {
    return this.team;
  }
  async getMatch(id: string) {
    return this.matches.find((value) => value.id === id)!;
  }
  async listMatches() {
    return this.matches;
  }
  async updateMatchLifecycle(value: Match) {
    this.matches = this.matches.map((item) =>
      item.id === value.id ? value : item,
    );
  }
  async countRateableParticipants() {
    return this.participantCount;
  }
  async hasTrackedTeamHeadCoach() {
    return this.hasCoach;
  }
  async getSyncMetadata() {
    return this.metadata;
  }
  async setSyncMetadata(value: FootballSyncMetadata) {
    this.metadata = value;
  }
  async updateTeamProviderId(team: Team) {
    return team;
  }
  async upsertCompetitions() {
    return counts;
  }
  async upsertSeasons() {
    return counts;
  }
  async upsertMatches() {
    return counts;
  }
  async upsertPlayers() {
    return counts;
  }
  async upsertMatchParticipants() {
    return counts;
  }
  async upsertCoaches() {
    return counts;
  }
  async upsertCoachAssignment() {
    return counts;
  }
}

class FixtureProvider implements FootballDataProvider {
  readonly name = "api-football";
  requestCount = 0;
  constructor(
    private readonly fixtureValue: ProviderFixture,
    private readonly failure?: Error,
  ) {}
  async getFixture() {
    this.requestCount += 1;
    if (this.failure) throw this.failure;
    return this.fixtureValue;
  }
  async resolveTeam(): Promise<ProviderTeamIdentity> {
    throw new Error("unused");
  }
  async getCompetitionSeasons(): Promise<ProviderCompetitionSeason[]> {
    return [];
  }
  async getFixtures() {
    return [];
  }
  async getMatchContext(): Promise<ProviderMatchContext> {
    throw new Error("unused");
  }
}

function fixture(status: ProviderFixture["status"]): ProviderFixture {
  return {
    externalFixtureId: "5001",
    externalCompetitionId: "71",
    providerSeason: 2026,
    kickoffAt: "2026-08-29T20:00:00.000Z",
    status,
    homeTeam: { externalProviderId: "815", name: "Tracked" },
    awayTeam: { externalProviderId: "2000", name: "Opponent" },
    score:
      status === "finished" ? { home: 2, away: 1 } : { home: null, away: null },
  };
}

function run(
  store: MemoryStore,
  provider: FixtureProvider,
  sync = async () => undefined,
) {
  return runMatchLifecycle({
    teamId: "tracked-team",
    store,
    provider,
    now: () => NOW,
    discoverFixtures: async () => undefined,
    syncParticipants: sync,
  });
}

describe("match lifecycle synchronization", () => {
  it("makes no provider call when no match exists and discovery is fresh", async () => {
    const store = new MemoryStore([]);
    const provider = new FixtureProvider(fixture("scheduled"));
    const result = await run(store, provider);
    expect(result.action).toBe("idle");
    expect(provider.requestCount).toBe(0);
  });

  it("discovers fixtures only when discovery is stale or no metadata exists", async () => {
    const store = new MemoryStore([]);
    store.metadata = null;
    let discoveries = 0;
    const provider = new FixtureProvider(fixture("scheduled"));
    const result = await runMatchLifecycle({
      teamId: "tracked-team",
      store,
      provider,
      now: () => NOW,
      discoverFixtures: async () => {
        discoveries += 1;
      },
      syncParticipants: async () => undefined,
    });
    expect(result.action).toBe("discovered");
    expect(discoveries).toBe(1);
    expect(provider.requestCount).toBe(0);
  });

  it("early-exits for a future match beyond 24 hours", async () => {
    const store = new MemoryStore([
      match({ kickoffAt: "2026-08-31T20:00:00.000Z" }),
    ]);
    const provider = new FixtureProvider(fixture("scheduled"));
    expect((await run(store, provider)).action).toBe("idle");
    expect(provider.requestCount).toBe(0);
  });

  it.each(["scheduled", "live"] as const)(
    "refreshes an imminent %s match",
    async (status) => {
      const store = new MemoryStore([match({ status })]);
      const provider = new FixtureProvider(fixture(status));
      expect((await run(store, provider)).action).toBe("refreshed");
      expect(provider.requestCount).toBe(1);
    },
  );

  it("keeps incomplete finished data preparing with no voting window", async () => {
    const store = new MemoryStore([match({ status: "live" })]);
    store.participantCount = 10;
    const result = await run(store, new FixtureProvider(fixture("finished")));
    expect(result.action).toBe("preparing_rating");
    expect(store.matches[0]).toMatchObject({
      ratingState: "preparing_rating",
      participantSyncedAt: NOW.toISOString(),
    });
    expect(store.matches[0].votingOpensAt).toBeUndefined();
  });

  it("opens one stable two-hour window after complete finished data", async () => {
    const store = new MemoryStore([match({ status: "live" })]);
    const provider = new FixtureProvider(fixture("finished"));
    expect((await run(store, provider)).action).toBe("rating_ready");
    const ready = store.matches[0];
    expect(ready).toMatchObject({
      ratingState: "rating_ready",
      votingOpensAt: NOW.toISOString(),
      votingClosesAt: "2026-08-29T20:00:00.000Z",
    });
    expect((await run(store, provider)).action).toBe("idle");
    expect(store.matches[0].votingOpensAt).toBe(ready.votingOpensAt);
  });

  it("closes an expired rating window without reopening it", async () => {
    const store = new MemoryStore([
      match({
        status: "finished",
        ratingState: "rating_ready",
        votingOpensAt: "2026-08-29T14:00:00.000Z",
        votingClosesAt: "2026-08-29T16:00:00.000Z",
      }),
    ]);
    expect(
      (await run(store, new FixtureProvider(fixture("finished")))).action,
    ).toBe("rating_closed");
    expect(store.matches[0].ratingState).toBe("rating_closed");
  });

  it.each(["postponed", "cancelled", "abandoned"] as const)(
    "never opens a window for %s",
    async (status) => {
      const store = new MemoryStore([match({ status: "live" })]);
      const result = await run(store, new FixtureProvider(fixture(status)));
      expect(result.action).toBe("refreshed");
      expect(store.matches[0].votingOpensAt).toBeUndefined();
    },
  );

  it("treats provider and participant failures as retryable without opening", async () => {
    const firstStore = new MemoryStore([match({ status: "live" })]);
    expect(
      (
        await run(
          firstStore,
          new FixtureProvider(fixture("finished"), new Error("offline")),
        )
      ).action,
    ).toBe("retryable_error");
    const secondStore = new MemoryStore([match({ status: "live" })]);
    const result = await run(
      secondStore,
      new FixtureProvider(fixture("finished")),
      async () => {
        throw new Error("lineup unavailable");
      },
    );
    expect(result.action).toBe("preparing_rating");
    expect(secondStore.matches[0].votingOpensAt).toBeUndefined();
  });

  it("works with the tracked Team home or away and rejects unrelated fixtures", async () => {
    const awayStore = new MemoryStore([
      match({
        homeTeam: { externalProviderId: "2000", name: "Opponent" },
        awayTeam: { externalProviderId: "815", name: "Tracked" },
      }),
    ]);
    const awayFixture = fixture("scheduled");
    [awayFixture.homeTeam, awayFixture.awayTeam] = [
      awayFixture.awayTeam,
      awayFixture.homeTeam,
    ];
    expect(
      (await run(awayStore, new FixtureProvider(awayFixture))).action,
    ).toBe("refreshed");
    const unrelated = fixture("scheduled");
    unrelated.homeTeam.externalProviderId = "9999";
    expect(
      (await run(new MemoryStore([match()]), new FixtureProvider(unrelated)))
        .action,
    ).toBe("retryable_error");

    const wrongFixture = fixture("scheduled");
    wrongFixture.externalFixtureId = "different-fixture";
    expect(
      (await run(new MemoryStore([match()]), new FixtureProvider(wrongFixture)))
        .action,
    ).toBe("retryable_error");
  });

  it("prioritizes active windows, live, preparing, then next scheduled", () => {
    const scheduled = match({
      id: "scheduled",
      kickoffAt: "2026-08-30T20:00:00.000Z",
    });
    const live = match({ id: "live", status: "live" });
    const ready = match({
      id: "ready",
      status: "finished",
      ratingState: "rating_ready",
      votingClosesAt: "2026-08-29T19:00:00.000Z",
    });
    expect(selectRelevantMatch([scheduled, live, ready], NOW)?.id).toBe(
      "ready",
    );
  });

  it("does not open rating windows for stale historical finished fixtures", () => {
    const historical = match({
      id: "historical",
      status: "finished",
      kickoffAt: "2026-05-03T02:00:00.000Z",
    });
    const upcoming = match({ id: "upcoming" });
    expect(selectRelevantMatch([historical, upcoming], NOW)?.id).toBe(
      "upcoming",
    );
  });
});
