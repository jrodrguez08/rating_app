import { describe, expect, it, vi } from "vitest";

import type { Match, Team } from "@/domain/models";
import type { FootballDataProvider, FootballSyncStore } from "@/domain/ports";

import {
  providerEntityId,
  syncMatchParticipants,
} from "./sync-match-participants";

describe("participant synchronization identities", () => {
  it("builds stable provider-mapped player and coach IDs", () => {
    expect(providerEntityId("player", "api-football", "10")).toBe(
      providerEntityId("player", "api-football", "10"),
    );
    expect(providerEntityId("player", "api-football", "10")).not.toBe(
      providerEntityId("coach", "api-football", "10"),
    );
  });

  it("uses a known alias for future match participants", async () => {
    const store = storeWith();
    await syncMatchParticipants(
      match.id,
      providerWith("541314"),
      store,
      new Date("2026-09-07T12:00:00.000Z"),
    );
    expect(vi.mocked(store.upsertPlayers).mock.calls[0][0][0].id).toBe(
      providerEntityId("player", "api-football", "36237"),
    );
    expect(
      vi.mocked(store.replaceMatchParticipants).mock.calls[0][1][0],
    ).toMatchObject({
      playerId: providerEntityId("player", "api-football", "36237"),
      externalProviderPlayerId: "541314",
    });
  });

  it("does not merge unknown players that share a name and shirt", async () => {
    const firstStore = storeWith();
    const secondStore = storeWith();
    await syncMatchParticipants(
      match.id,
      providerWith("unknown-1"),
      firstStore,
    );
    await syncMatchParticipants(
      match.id,
      providerWith("unknown-2"),
      secondStore,
    );
    const firstId = vi.mocked(firstStore.upsertPlayers).mock.calls[0][0][0].id;
    const secondId = vi.mocked(secondStore.upsertPlayers).mock.calls[0][0][0]
      .id;
    expect(firstId).not.toBe(secondId);
  });
});

const team: Team = {
  id: "team",
  displayName: "Tracked",
  shortName: "Tracked",
  countryName: "Costa Rica",
  countryCode: "CR",
  externalProviderId: "815",
  brandingKey: "tracked",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const match: Match = {
  id: "match",
  trackedTeamId: team.id,
  competitionId: "competition",
  seasonId: "season",
  homeTeam: { externalProviderId: "815", name: "Tracked" },
  awayTeam: { externalProviderId: "900", name: "Opponent" },
  kickoffAt: "2026-09-07T12:00:00.000Z",
  status: "finished",
  ratingState: "not_ready",
  score: { home: 1, away: 0 },
  externalProvider: "api-football",
  externalProviderFixtureId: "fixture",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function providerWith(externalPlayerId: string): FootballDataProvider {
  return {
    name: "api-football",
    requestCount: 1,
    getMatchContext: vi.fn().mockResolvedValue({
      participants: [
        {
          externalTeamId: "815",
          externalPlayerId,
          name: "S. Rodriguez",
          shirtNumber: 24,
          position: "midfielder",
          squadRole: "starter",
          participated: true,
        },
      ],
      headCoach: {
        externalTeamId: "815",
        externalCoachId: "coach-1",
        name: "Coach",
      },
    }),
    resolveTeam: vi.fn(),
    getCompetitionSeasons: vi.fn(),
    getFixtures: vi.fn(),
    getFixture: vi.fn(),
    getLineupContext: vi.fn(),
    getSquad: vi.fn(),
  };
}

function storeWith(): FootballSyncStore {
  const counts = { created: 1, updated: 0, unchanged: 0 };
  return {
    getTeam: vi.fn().mockResolvedValue(team),
    getMatch: vi.fn().mockResolvedValue(match),
    resolvePlayerProviderAliases: vi.fn(async (aliases) => aliases),
    upsertPlayers: vi.fn().mockResolvedValue(counts),
    replaceMatchParticipants: vi.fn().mockResolvedValue(counts),
    upsertCoaches: vi.fn().mockResolvedValue(counts),
    upsertCoachAssignment: vi.fn().mockResolvedValue(counts),
    updateTeamProviderId: vi.fn(),
    upsertCompetitions: vi.fn(),
    upsertSeasons: vi.fn(),
    upsertMatches: vi.fn(),
    upsertMatchParticipants: vi.fn(),
    getPersistedMatchContext: vi.fn(),
  };
}
