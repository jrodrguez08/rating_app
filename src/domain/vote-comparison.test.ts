import { describe, expect, it } from "vitest";

import type { Ballot, MatchResult } from "./models";
import { compareVoteWithResult } from "./vote-comparison";

const ballot: Ballot = {
  id: "voter-a",
  matchId: "match-1",
  voterId: "voter-a",
  teamId: "team-1",
  submittedAt: "2026-08-29T19:00:00.000Z",
  playerRatings: { legacy: 8, second: 6, third: 7 },
  coachRating: { coachId: "coach-1", rating: 8 },
};
const result: MatchResult = {
  matchId: "match-1",
  teamId: "team-1",
  ballotCount: 2,
  status: "final",
  playerResults: {
    canonical: {
      playerId: "canonical",
      playerName: "First",
      average: 7.3,
      voteCount: 2,
      order: 0,
    },
    second: {
      playerId: "second",
      playerName: "Second",
      average: 7.1,
      voteCount: 2,
      order: 1,
    },
    third: {
      playerId: "third",
      playerName: "Third",
      average: 7,
      voteCount: 2,
      order: 2,
    },
  },
  coachResult: {
    coachId: "coach-1",
    coachName: "Coach",
    average: 7.5,
    voteCount: 2,
  },
  mvpPlayerIds: ["canonical"],
  generatedAt: "2026-08-29T20:00:00.000Z",
};

describe("vote comparison", () => {
  it("matches reviewed canonical IDs, preserves result order, and calculates signed differences", () => {
    const comparison = compareVoteWithResult(
      ballot,
      result,
      new Map([["legacy", "canonical"]]),
    );
    expect(
      comparison?.players.map(({ id, difference }) => [
        id,
        Math.round(difference * 10) / 10,
      ]),
    ).toEqual([
      ["canonical", 0.7],
      ["second", -1.1],
      ["third", 0],
    ]);
    expect(comparison?.coach).toMatchObject({
      id: "coach-1",
      userRating: 8,
      communityAverage: 7.5,
      difference: 0.5,
    });
  });

  it("fails closed for unknown identity, incomplete data, and coach mismatch", () => {
    expect(compareVoteWithResult(ballot, result, new Map())).toBeNull();
    expect(
      compareVoteWithResult(
        { ...ballot, playerRatings: { legacy: 8 } },
        result,
        new Map([["legacy", "canonical"]]),
      ),
    ).toBeNull();
    expect(
      compareVoteWithResult(
        { ...ballot, coachRating: { coachId: "other", rating: 8 } },
        result,
        new Map([["legacy", "canonical"]]),
      ),
    ).toBeNull();
  });
});
