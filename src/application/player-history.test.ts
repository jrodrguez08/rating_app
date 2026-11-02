import { describe, expect, it } from "vitest";

import type { Match, MatchResult } from "@/domain/models";

import {
  adjustedPlayerRating,
  buildPlayerCatalog,
  PLAYER_RANKING_MIN_MATCHES,
  PLAYER_RANKING_PRIOR_MATCH_WEIGHT,
  PLAYER_TREND_STABILITY_THRESHOLD,
  playerRatingTrend,
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
      rankingScore: 8,
      ratedMatchCount: 2,
      rank: 1,
      recentRating: 9,
      trend: null,
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

  it("accepts the tracked Team away and excludes an unrelated fixture", () => {
    const away = match("away", {
      homeTeam: { externalProviderId: "200", name: "Home opponent" },
      awayTeam: { externalProviderId: "815", name: "Herediano" },
    });
    const unrelated = match("unrelated", {
      homeTeam: { externalProviderId: "300", name: "Other home" },
      awayTeam: { externalProviderId: "400", name: "Other away" },
    });
    const catalog = build(
      [
        result("away", { stable: player("stable", "Stable", 8) }),
        result("unrelated", { stable: player("stable", "Stable", 10) }),
      ],
      [away, unrelated],
    );

    expect(catalog.players[0]).toMatchObject({
      overallAverage: 8,
      ratedMatchCount: 1,
      history: [expect.objectContaining({ opponentName: "Home opponent" })],
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
    expect(PLAYER_RANKING_PRIOR_MATCH_WEIGHT).toBe(3);
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

  it("combines explicit aliases into one ranked canonical history", () => {
    const catalog = buildPlayerCatalog({
      identities: [
        { id: "canonical", name: "Current name", position: "midfielder" },
        { id: "legacy", name: "Old snapshot" },
        { id: "similar", name: "S. Rodriguez" },
      ],
      matches: [match("older"), match("newer", {}, 1)],
      results: [
        result("older", { legacy: player("legacy", "Old snapshot", 7) }),
        result("newer", {
          canonical: player("canonical", "Current name", 9),
        }),
      ],
      trackedTeamExternalProviderId: "815",
      canonicalPlayerIds: new Map([["legacy", "canonical"]]),
    });

    expect(catalog.players).toHaveLength(2);
    expect(
      catalog.players.find(({ playerId }) => playerId === "canonical"),
    ).toMatchObject({
      playerName: "Current name",
      position: "midfielder",
      overallAverage: 8,
      rankingScore: 8,
      ratedMatchCount: 2,
      rank: 1,
      recentRating: 9,
    });
    expect(
      catalog.players
        .find(({ playerId }) => playerId === "canonical")
        ?.history.map(({ matchId, average }) => ({ matchId, average })),
    ).toEqual([
      { matchId: "newer", average: 9 },
      { matchId: "older", average: 7 },
    ]);
    expect(
      catalog.players.find(({ playerId }) => playerId === "similar"),
    ).toMatchObject({ ratedMatchCount: 0 });
  });

  it("counts equivalent alias and canonical results from one match once", () => {
    const catalog = buildPlayerCatalog({
      identities: [
        { id: "canonical", name: "Current name" },
        { id: "legacy", name: "Old snapshot" },
      ],
      matches: [match("same-match")],
      results: [
        result("same-match", {
          legacy: player("legacy", "Old snapshot", 8),
          canonical: player("canonical", "Current name", 8),
        }),
      ],
      trackedTeamExternalProviderId: "815",
      canonicalPlayerIds: new Map([["legacy", "canonical"]]),
    });

    expect(catalog.players).toEqual([
      expect.objectContaining({
        playerId: "canonical",
        overallAverage: 8,
        ratedMatchCount: 1,
        recentRating: 8,
      }),
    ]);
    expect(catalog.referenceMean).toBe(8);
  });

  it("rejects conflicting alias and canonical results from one match", () => {
    expect(() =>
      buildPlayerCatalog({
        identities: [{ id: "canonical", name: "Current name" }],
        matches: [match("same-match")],
        results: [
          result("same-match", {
            legacy: player("legacy", "Old snapshot", 7),
            canonical: player("canonical", "Current name", 9),
          }),
        ],
        trackedTeamExternalProviderId: "815",
        canonicalPlayerIds: new Map([["legacy", "canonical"]]),
      }),
    ).toThrow(/same-match.*conflicting ratings.*canonical/i);
  });

  it("never exposes ballot or voter fields in its public DTO", () => {
    expect(JSON.stringify(build([result("older", {})]))).not.toMatch(
      /ballot|voterId|playerRatings/i,
    );
  });

  it("uses the fixed participation adjustment without replacing the raw average", () => {
    expect(adjustedPlayerRating(2, 9.2, 7)).toBeCloseTo(7.88, 10);
    expect(adjustedPlayerRating(8, 8.7, 7)).toBeCloseTo(8.236363636363636, 10);
    expect(adjustedPlayerRating(2, 7, 7)).toBe(7);
    expect(adjustedPlayerRating(2, 6, 7)).toBeCloseTo(6.6, 10);
    expect(adjustedPlayerRating(20, 9, 7)).toBeGreaterThan(
      adjustedPlayerRating(2, 9, 7),
    );
    expect(adjustedPlayerRating(20, 6, 7)).toBeLessThan(
      adjustedPlayerRating(2, 6, 7),
    );
  });

  it("computes one canonical player-match reference mean and ranks by adjusted score", () => {
    const results = Array.from({ length: 8 }, (_, index) =>
      result(`match-${index}`, {
        ...(index < 2 ? { small: player("small", "Small sample", 9.2) } : {}),
        proven: player("proven", "Proven", 8.7),
        reference: player("reference", "Reference", 4.75),
      }),
    );
    const catalog = buildPlayerCatalog({
      identities: [
        { id: "small", name: "Small sample" },
        { id: "proven", name: "Proven" },
        { id: "reference", name: "Reference" },
      ],
      matches: results.map((value, index) => match(value.matchId, {}, index)),
      results,
      trackedTeamExternalProviderId: "815",
    });
    const small = catalog.players.find(({ playerId }) => playerId === "small");
    const proven = catalog.players.find(
      ({ playerId }) => playerId === "proven",
    );

    expect(catalog.referenceMean).toBeCloseTo(7, 10);
    expect(small).toMatchObject({ overallAverage: 9.2, ratedMatchCount: 2 });
    expect(proven?.ratedMatchCount).toBe(8);
    expect(proven?.overallAverage).toBeCloseTo(8.7, 10);
    expect(proven?.rankingScore).toBeGreaterThan(small?.rankingScore ?? 0);
    expect(proven?.rank).toBeLessThan(small?.rank ?? Number.MAX_SAFE_INTEGER);
  });

  it("keeps one-match players unranked and leaves scores unavailable without evidence", () => {
    const oneMatch = build([
      result("only", { stable: player("stable", "Snapshot", 9.8) }),
    ]);
    const empty = build([]);

    expect(oneMatch.players[0]).toMatchObject({
      overallAverage: 9.8,
      ratedMatchCount: 1,
      rankingScore: null,
      rank: null,
    });
    expect(empty.referenceMean).toBeNull();
    expect(empty.players[0]).toMatchObject({
      overallAverage: null,
      rankingScore: null,
      rank: null,
    });
  });

  it("excludes invalid observations from history and the shared reference mean", () => {
    const stale = result("stale", {
      stable: { ...player("stable", "Stable", 9), voteCount: 1 },
    });
    const wrongTeam = result("wrong-team", {
      stable: player("stable", "Stable", 10),
    });
    wrongTeam.teamId = "other-team";
    const catalog = build([
      result("valid", { stable: player("stable", "Stable", 8) }),
      stale,
      wrongTeam,
      result("nan", {
        stable: player("stable", "Stable", Number.NaN),
      }),
      result("range", { other: player("other", "Other", 11) }),
    ]);

    expect(catalog.referenceMean).toBe(8);
    expect(
      catalog.players.find(({ playerId }) => playerId === "stable"),
    ).toMatchObject({ overallAverage: 8, ratedMatchCount: 1 });
    expect(
      catalog.players.find(({ playerId }) => playerId === "other"),
    ).toBeUndefined();
  });

  it("uses raw average before participation when adjusted scores are exactly equal", () => {
    const results = Array.from({ length: 6 }, (_, index) =>
      result(`match-${index}`, {
        ...(index < 3 ? { higher: player("higher", "Higher raw", 8) } : {}),
        lower: player("lower", "Lower raw", 7.5),
        ballast: player("ballast", "Ballast", 3.5),
      }),
    );
    const catalog = buildPlayerCatalog({
      identities: [
        { id: "higher", name: "Higher raw" },
        { id: "lower", name: "Lower raw" },
        { id: "ballast", name: "Ballast" },
      ],
      matches: results.map((value, index) => match(value.matchId, {}, index)),
      results,
      trackedTeamExternalProviderId: "815",
    });
    const higher = catalog.players.find(
      ({ playerId }) => playerId === "higher",
    );
    const lower = catalog.players.find(({ playerId }) => playerId === "lower");

    expect(catalog.referenceMean).toBe(6);
    expect(higher?.rankingScore).toBe(7);
    expect(lower?.rankingScore).toBe(7);
    expect(higher?.rank).toBeLessThan(lower?.rank ?? Number.MAX_SAFE_INTEGER);
  });

  it("uses raw average, participation, and canonical ID as deterministic score ties", () => {
    const catalog = buildPlayerCatalog({
      identities: [
        { id: "alpha", name: "Alpha" },
        { id: "beta", name: "Beta" },
      ],
      matches: [match("one"), match("two", {}, 1)],
      results: [
        result("one", {
          alpha: player("alpha", "Alpha", 8),
          beta: player("beta", "Beta", 8),
        }),
        result("two", {
          alpha: player("alpha", "Alpha", 8),
          beta: player("beta", "Beta", 8),
        }),
      ],
      trackedTeamExternalProviderId: "815",
    });

    expect(
      catalog.players.map(({ playerId, rank }) => [playerId, rank]),
    ).toEqual([
      ["alpha", 1],
      ["beta", 2],
    ]);
  });

  it("derives recent progression from exactly the latest six chronological matches", () => {
    const history = [
      ratingHistory("old", "2026-01-01T18:00:00.000Z", 1),
      ratingHistory("previous-1", "2026-02-01T18:00:00.000Z", 7),
      ratingHistory("previous-2", "2026-03-01T18:00:00.000Z", 7.2),
      ratingHistory("previous-3", "2026-04-01T18:00:00.000Z", 7.1),
      ratingHistory("recent-1", "2026-05-01T18:00:00.000Z", 7.8),
      ratingHistory("recent-2", "2026-06-01T18:00:00.000Z", 8),
      ratingHistory("recent-3", "2026-07-01T18:00:00.000Z", 7.9),
    ];

    const trend = playerRatingTrend(history);
    expect(trend?.direction).toBe("improving");
    expect(trend?.previousAverage).toBeCloseTo(7.1, 10);
    expect(trend?.recentAverage).toBeCloseTo(7.9, 10);
    expect(trend?.delta).toBeCloseTo(0.8, 10);
    expect(playerRatingTrend(history.slice(0, 5))).toBeNull();
  });

  it("classifies declining, stable, and exact threshold trends with full precision", () => {
    expect(playerRatingTrend(trendRatings([8, 8, 8, 7, 7, 7]))?.direction).toBe(
      "declining",
    );
    const threshold = playerRatingTrend(trendRatings([7, 7, 7, 7.1, 7.2, 7.3]));
    expect(threshold?.direction).toBe("stable");
    expect(threshold?.delta).toBeCloseTo(0.2, 10);
    expect(PLAYER_TREND_STABILITY_THRESHOLD).toBe(0.2);
    expect(
      playerRatingTrend(trendRatings([7, 7, 7, 7.2, 7.2, 7.21]))?.direction,
    ).toBe("improving");
  });

  it("breaks equal-kickoff chronology by stable match ID", () => {
    const trend = playerRatingTrend([
      ratingHistory("a", "2026-01-01T18:00:00.000Z", 6),
      ratingHistory("b", "2026-01-01T18:00:00.000Z", 6),
      ratingHistory("c", "2026-01-01T18:00:00.000Z", 6),
      ratingHistory("d", "2026-01-01T18:00:00.000Z", 8),
      ratingHistory("e", "2026-01-01T18:00:00.000Z", 8),
      ratingHistory("f", "2026-01-01T18:00:00.000Z", 8),
    ]);

    expect(trend).toMatchObject({
      direction: "improving",
      previousAverage: 6,
      recentAverage: 8,
    });
  });

  it("keeps progression informational and outside ranking order", () => {
    const declining = [9, 9, 9, 7, 7, 7];
    const improving = [7, 7, 7, 9, 9, 9];
    const results = declining.map((average, index) =>
      result(`trend-${index}`, {
        "a-declining": player("a-declining", "Declining", average),
        "z-improving": player("z-improving", "Improving", improving[index]!),
      }),
    );
    const catalog = buildPlayerCatalog({
      identities: [
        { id: "a-declining", name: "Declining" },
        { id: "z-improving", name: "Improving" },
      ],
      matches: results.map((value, index) => match(value.matchId, {}, index)),
      results,
      trackedTeamExternalProviderId: "815",
    });

    expect(catalog.players[0]).toMatchObject({
      playerId: "a-declining",
      rank: 1,
      trend: { direction: "declining" },
    });
    expect(catalog.players[1]).toMatchObject({
      playerId: "z-improving",
      rank: 2,
      trend: { direction: "improving" },
    });
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

function ratingHistory(matchId: string, kickoffAt: string, average: number) {
  return {
    matchId,
    kickoffAt,
    opponentName: "Opponent",
    homeTeamName: "Herediano",
    awayTeamName: "Opponent",
    score: { home: 1, away: 0 },
    average,
    voteCount: 2,
  };
}

function trendRatings(averages: number[]) {
  return averages.map((average, index) =>
    ratingHistory(
      `match-${index}`,
      new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      average,
    ),
  );
}
