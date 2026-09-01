import { describe, expect, it, vi } from "vitest";

import type { Team } from "@/domain/models";
import type { FootballDataProvider, FootballSyncStore } from "@/domain/ports";

import { providerEntityId } from "./sync-match-participants";
import { syncPlayerSquad } from "./sync-player-squad";

const team: Team = {
  id: "club-sport-herediano",
  displayName: "Club Sport Herediano",
  shortName: "Herediano",
  countryName: "Costa Rica",
  countryCode: "CR",
  brandingKey: "herediano",
  externalProviderId: "815",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("syncPlayerSquad", () => {
  it("upserts current metadata by stable provider ID in one bounded request", async () => {
    const upsertPlayers = vi.fn().mockResolvedValue({
      created: 1,
      updated: 0,
      unchanged: 0,
    });
    const provider = providerWith([
      {
        externalPlayerId: "101",
        name: "Player Name",
        position: "defender",
        photoUrl: "https://media.api-sports.io/football/players/101.png",
      },
    ]);

    const summary = await syncPlayerSquad(
      team.id,
      provider,
      storeWith(upsertPlayers),
      new Date("2026-09-01T12:00:00.000Z"),
    );

    expect(upsertPlayers).toHaveBeenCalledWith([
      expect.objectContaining({
        id: providerEntityId("player", "api-football", "101"),
        externalProviderId: "101",
        displayName: "Player Name",
        position: "defender",
        photoUrl: "https://media.api-sports.io/football/players/101.png",
      }),
    ]);
    expect(summary).toMatchObject({ squadSize: 1, apiRequests: 1 });
  });

  it("omits missing optional metadata so persistence can preserve last-known values", async () => {
    const upsertPlayers = vi.fn().mockResolvedValue({
      created: 0,
      updated: 0,
      unchanged: 1,
    });
    await syncPlayerSquad(
      team.id,
      providerWith([{ externalPlayerId: "101", name: "Current Name" }]),
      storeWith(upsertPlayers),
    );
    expect(upsertPlayers.mock.calls[0][0][0]).not.toHaveProperty("position");
    expect(upsertPlayers.mock.calls[0][0][0]).not.toHaveProperty("photoUrl");
  });

  it("rejects an empty usable squad instead of implying a destructive success", async () => {
    await expect(
      syncPlayerSquad(team.id, providerWith([]), storeWith(vi.fn())),
    ).rejects.toThrow(/no usable squad players/i);
  });
});

function providerWith(
  squad: Awaited<ReturnType<FootballDataProvider["getSquad"]>>,
): FootballDataProvider {
  return {
    name: "api-football",
    requestCount: 1,
    getSquad: vi.fn().mockResolvedValue(squad),
    resolveTeam: vi.fn(),
    getCompetitionSeasons: vi.fn(),
    getFixtures: vi.fn(),
    getFixture: vi.fn(),
    getMatchContext: vi.fn(),
  };
}

function storeWith(
  upsertPlayers: FootballSyncStore["upsertPlayers"],
): FootballSyncStore {
  return {
    getTeam: vi.fn().mockResolvedValue(team),
    getMatch: vi.fn(),
    updateTeamProviderId: vi.fn(),
    upsertCompetitions: vi.fn(),
    upsertSeasons: vi.fn(),
    upsertMatches: vi.fn(),
    upsertPlayers,
    upsertMatchParticipants: vi.fn(),
    upsertCoaches: vi.fn(),
    upsertCoachAssignment: vi.fn(),
  };
}
