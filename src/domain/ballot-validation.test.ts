import { describe, expect, it } from "vitest";

import { validateBallotRatings } from "./ballot-validation";

const valid = {
  playerRatings: { "player-1": 1, "player-2": 10 },
  coachRating: { coachId: "coach-1", rating: 7 },
};

describe("validateBallotRatings", () => {
  it("accepts the exact participant set and integer boundaries", () => {
    expect(
      validateBallotRatings(["player-2", "player-1"], "coach-1", valid),
    ).toEqual({ valid: true, ratings: valid });
  });

  it.each([
    { ...valid, playerRatings: { "player-1": 5 } },
    { ...valid, playerRatings: { ...valid.playerRatings, opponent: 5 } },
    { ...valid, playerRatings: { ...valid.playerRatings, "player-1": 0 } },
    { ...valid, playerRatings: { ...valid.playerRatings, "player-1": 11 } },
    { ...valid, playerRatings: { ...valid.playerRatings, "player-1": 5.5 } },
    { ...valid, coachRating: { coachId: "coach-1", rating: 0 } },
    { ...valid, coachRating: { coachId: "opponent", rating: 7 } },
    { playerRatings: valid.playerRatings },
    { ...valid, unexpected: true },
  ])("rejects incomplete, unexpected, or invalid ratings", (input) => {
    expect(
      validateBallotRatings(["player-1", "player-2"], "coach-1", input),
    ).toEqual({ valid: false, reason: "invalid_ballot" });
  });

  it("rejects an inconsistent expected set", () => {
    expect(
      validateBallotRatings(["player-1", "player-1"], "coach-1", valid),
    ).toEqual({ valid: false, reason: "invalid_ballot" });
  });
});
