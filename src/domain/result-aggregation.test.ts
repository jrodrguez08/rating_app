import { describe, expect, it } from "vitest";

import type {
  Ballot,
  CoachAssignment,
  MatchParticipant,
} from "@/domain/models";

import {
  aggregateMatchResult,
  ResultIntegrityError,
} from "./result-aggregation";

const generatedAt = "2026-08-29T20:00:00.000Z";
const participants = [
  participant("p1", "Player One"),
  participant("p2", "Player Two"),
];
const coach: CoachAssignment = {
  matchId: "match-1",
  coachId: "coach-1",
  teamId: "team-1",
  externalProviderTeamId: "815",
  role: "head-coach",
  coachName: "Coach One",
  createdAt: generatedAt,
  updatedAt: generatedAt,
};

describe("match result aggregation", () => {
  it("handles zero ballots without dividing by zero", () => {
    const result = aggregate([]);
    expect(result).toMatchObject({
      ballotCount: 0,
      status: "no_votes",
      mvpPlayerIds: [],
    });
    expect(result.playerResults.p1.average).toBe(0);
    expect(result.coachResult.average).toBe(0);
  });

  it("calculates one complete ballot including 1 and 10 boundaries", () => {
    const result = aggregate([ballot("v1", 1, 10, 7)]);
    expect(result.playerResults.p1).toMatchObject({ average: 1, voteCount: 1 });
    expect(result.playerResults.p2.average).toBe(10);
    expect(result.coachResult.average).toBe(7);
    expect(result.mvpPlayerIds).toEqual(["p2"]);
  });

  it("keeps full precision averages and supports tied MVPs", () => {
    const result = aggregate([
      ballot("v1", 8, 9, 6),
      ballot("v2", 10, 9, 8),
      ballot("v3", 9, 9, 10),
    ]);
    expect(result.playerResults.p1.average).toBe(9);
    expect(result.playerResults.p2.average).toBe(9);
    expect(result.coachResult.average).toBe(8);
    expect(result.mvpPlayerIds).toEqual(["p1", "p2"]);
  });

  it("preserves deterministic participant order", () => {
    const result = aggregate([ballot("v1", 8, 8, 8)]);
    expect(
      Object.values(result.playerResults).map((value) => value.order),
    ).toEqual([0, 1]);
  });

  it.each([
    [
      "missing player",
      {
        playerRatings: { p1: 8 },
        coachRating: { coachId: "coach-1", rating: 8 },
      },
    ],
    [
      "extra player",
      {
        playerRatings: { p1: 8, p2: 8, p3: 8 },
        coachRating: { coachId: "coach-1", rating: 8 },
      },
    ],
    [
      "invalid coach",
      {
        playerRatings: { p1: 8, p2: 8 },
        coachRating: { coachId: "other", rating: 8 },
      },
    ],
    [
      "rating below range",
      {
        playerRatings: { p1: 0, p2: 8 },
        coachRating: { coachId: "coach-1", rating: 8 },
      },
    ],
    [
      "rating above range",
      {
        playerRatings: { p1: 11, p2: 8 },
        coachRating: { coachId: "coach-1", rating: 8 },
      },
    ],
    [
      "decimal rating",
      {
        playerRatings: { p1: 8.5, p2: 8 },
        coachRating: { coachId: "coach-1", rating: 8 },
      },
    ],
  ])("rejects malformed persisted data: %s", (_name, ratings) => {
    const invalid = { ...ballot("v1", 8, 8, 8), ...ratings };
    expect(() => aggregate([invalid as Ballot])).toThrow(ResultIntegrityError);
  });

  it("rejects a ballot for another match or Team", () => {
    expect(() =>
      aggregate([{ ...ballot("v1", 8, 8, 8), teamId: "other" }]),
    ).toThrow(ResultIntegrityError);
  });

  it("rejects missing eligibility or an invalid coach assignment", () => {
    expect(() =>
      aggregateMatchResult({
        matchId: "match-1",
        teamId: "team-1",
        participants: [],
        coach,
        ballots: [],
        generatedAt,
      }),
    ).toThrow(ResultIntegrityError);
    expect(() =>
      aggregateMatchResult({
        matchId: "match-1",
        teamId: "team-1",
        participants,
        coach: { ...coach, teamId: "other" },
        ballots: [],
        generatedAt,
      }),
    ).toThrow(ResultIntegrityError);
  });
});

function aggregate(ballots: Ballot[]) {
  return aggregateMatchResult({
    matchId: "match-1",
    teamId: "team-1",
    participants,
    coach,
    ballots,
    generatedAt,
  });
}

function participant(playerId: string, playerName: string): MatchParticipant {
  return {
    matchId: "match-1",
    playerId,
    teamId: "team-1",
    externalProvider: "api-football",
    externalProviderTeamId: "815",
    externalProviderPlayerId: playerId,
    playerName,
    squadRole: "starter",
    starter: true,
    participated: true,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

function ballot(
  voterId: string,
  p1: number,
  p2: number,
  coachRating: number,
): Ballot {
  return {
    id: voterId,
    matchId: "match-1",
    voterId,
    teamId: "team-1",
    submittedAt: generatedAt,
    playerRatings: { p1, p2 },
    coachRating: { coachId: "coach-1", rating: coachRating },
  };
}
