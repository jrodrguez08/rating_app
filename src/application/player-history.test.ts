import { describe, expect, it } from "vitest";

import type { Match, MatchResult } from "@/domain/models";

import {
  buildPlayerCatalog,
  PLAYER_RANKING_MIN_MATCHES,
} from "./player-history";

describe("player history", () => {
  it("averages published per-match ratings, orders recent history, and merges stable identity", () => {
    const catalog = build([
      result("older", { stable: player("stable", "Old display name", 7) }),
      result("newer", { stable: player("stable", "New snapshot", 9) }),
    ]);
    const value = catalog.players.find(({ playerId }) => playerId === "stable");

    expect(value).toMatchObject({
      playerName: "Current persisted name",
      position: "midfielder",
      photoUrl: "https://media.api-sports.io/football/players/1.png",
      overallAverage: 8,
      ratedMatchCount: 2,
      rank: 1,
    });
    expect(value?.history.map(({ matchId }) => matchId)).toEqual([
      "newer",
      "older",
    ]);
    expect(
      catalog.players.filter(({ playerId }) => playerId === "stable"),
    ).toHaveLength(1);
  });

  it.each([
    ["active", "rating_ready" as const, "2026-09-01T14:00:00.000Z"],
    ["expired", "rating_ready" as const, "2026-08-30T14:00:00.000Z"],
  ])("excludes %s unfinalized results", (id, ratingState, votingClosesAt) => {
    const catalog = build(
      [result(id, { stable: player("stable", "Snapshot", 10) })],
      [match(id, { ratingState, votingClosesAt })],
    );

    expect(catalog.players[0]).toMatchObject({
      ratedMatchCount: 0,
      overallAverage: null,
      rank: null,
    });
  });

  it("counts each closed summary once and keeps historical result-only players addressable", () => {
    const catalog = build([
      result("older", { historical: player("historical", "Former player", 8) }),
    ]);

    expect(catalog.players).toEqual([
      expect.objectContaining({
        playerId: "historical",
        playerName: "Former player",
        ratedMatchCount: 1,
      }),
      expect.objectContaining({ playerId: "stable", ratedMatchCount: 0 }),
    ]);
  });

  it("ranks deterministically by average, match count, then stable ID", () => {
    const results = [
      result("older", {
        alpha: player("alpha", "Alpha", 8),
        beta: player("beta", "Beta", 8),
        gamma: player("gamma", "Gamma", 8),
        single: player("single", "Single", 9),
      }),
      result("newer", {
        alpha: player("alpha", "Alpha", 8),
        beta: player("beta", "Beta", 8),
        gamma: player("gamma", "Gamma", 7),
      }),
      result("third", { beta: player("beta", "Beta", 8) }),
    ];
    const catalog = build(results);

    expect(PLAYER_RANKING_MIN_MATCHES).toBe(2);
    expect(
      catalog.players
        .filter(({ rank }) => rank !== null)
        .map(({ playerId, rank }) => [playerId, rank]),
    ).toEqual([
      ["beta", 1],
      ["alpha", 2],
      ["gamma", 3],
    ]);
    expect(
      catalog.players.find(({ playerId }) => playerId === "single"),
    ).toMatchObject({ overallAverage: 9, ratedMatchCount: 1, rank: null });
  });

  it("never exposes ballot or voter fields in its public DTO", () => {
    expect(JSON.stringify(build([result("older", {})]))).not.toMatch(
      /ballot|voterId|playerRatings/i,
    );
  });
});

function build(results: MatchResult[], matches?: Match[]) {
  return buildPlayerCatalog({
    identities: [
      {
        id: "stable",
        name: "Current persisted name",
        position: "midfielder",
        photoUrl: "https://media.api-sports.io/football/players/1.png",
      },
    ],
    matches:
      matches ?? results.map((value, index) => match(value.matchId, {}, index)),
    results,
    trackedTeamExternalProviderId: "815",
  });
}

function match(id: string, overrides: Partial<Match> = {}, index = 0): Match {
  return {
    id,
    trackedTeamId: "team",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: String(index + 2), name: `Opponent ${id}` },
    kickoffAt: new Date(Date.UTC(2026, 7, 20 + index)).toISOString(),
    status: "finished",
    ratingState: "rating_closed",
    score: { home: 2, away: 1 },
    externalProvider: "api-football",
    externalProviderFixtureId: id,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function result(
  matchId: string,
  playerResults: MatchResult["playerResults"],
): MatchResult {
  return {
    matchId,
    teamId: "team",
    ballotCount: 2,
    playerResults,
    coachResult: {
      coachId: "coach",
      coachName: "Coach",
      average: 7,
      voteCount: 2,
    },
    mvpPlayerIds: [],
    status: "final",
    generatedAt: "2026-08-30T00:00:00.000Z",
  };
}

function player(playerId: string, playerName: string, average: number) {
  return { playerId, playerName, average, voteCount: 2, order: 0 };
}
