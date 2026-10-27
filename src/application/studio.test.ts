import { describe, expect, it } from "vitest";

import type { PublishedResultPodium } from "@/application/published-result-podium";
import type { Match, MatchResult } from "@/domain/models";

import { buildStudioMatchPresentation } from "./studio";

describe("Studio match presentation", () => {
  it("derives radiography metrics from the canonical published ordering", () => {
    const presentation = buildStudioMatchPresentation(match, result, podium);

    expect(presentation).toMatchObject({
      playerAverage: 8,
      highestRatedPlayer: { playerId: "canonical", average: 9, rank: 1 },
      lowestRatedPlayer: { playerId: "third", average: 7, rank: 3 },
    });
    expect(
      presentation?.podium.topThree.map(({ playerId }) => playerId),
    ).toEqual(["canonical", "second", "third"]);
    expect(presentation?.result.coachResult).toEqual(result.coachResult);
  });

  it("rejects missing or mismatched published projections", () => {
    expect(buildStudioMatchPresentation(match, result, null)).toBeNull();
    expect(
      buildStudioMatchPresentation(
        match,
        { ...result, matchId: "another-match" },
        podium,
      ),
    ).toBeNull();
  });
});

const match: Match = {
  id: "match-1",
  trackedTeamId: "team-1",
  competitionId: "competition-1",
  seasonId: "season-1",
  homeTeam: { externalProviderId: "815", name: "Herediano" },
  awayTeam: { externalProviderId: "819", name: "Pérez Zeledón" },
  kickoffAt: "2026-10-20T02:00:00.000Z",
  status: "finished",
  ratingState: "rating_closed",
  score: { home: 2, away: 1 },
  externalProvider: "api-football",
  externalProviderFixtureId: "1551706",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T05:00:00.000Z",
};

const result: MatchResult = {
  matchId: match.id,
  teamId: match.trackedTeamId,
  ballotCount: 4,
  status: "final",
  playerResults: {},
  coachResult: {
    coachId: "coach-1",
    coachName: "Jafet Soto",
    average: 7.5,
    voteCount: 4,
  },
  mvpPlayerIds: ["canonical"],
  generatedAt: "2026-10-20T05:00:00.000Z",
};

const podium: PublishedResultPodium = {
  matchId: match.id,
  homeTeam: match.homeTeam,
  awayTeam: match.awayTeam,
  score: { home: 2, away: 1 },
  publishedMatchDate: match.kickoffAt,
  generatedAt: result.generatedAt,
  players: [
    player("canonical", "Jugador canónico", 9, 1, true),
    player("second", "Segundo", 8, 2),
    player("third", "Tercero", 7, 3),
  ],
  topThree: [
    player("canonical", "Jugador canónico", 9, 1, true),
    player("second", "Segundo", 8, 2),
    player("third", "Tercero", 7, 3),
  ],
};

function player(
  playerId: string,
  displayName: string,
  average: number,
  rank: number,
  isMvp = false,
) {
  return { playerId, displayName, average, voteCount: 4, rank, isMvp };
}
