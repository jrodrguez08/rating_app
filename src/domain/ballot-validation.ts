import type { BallotRatings } from "@/domain/models";

export type BallotValidationResult =
  | { valid: true; ratings: BallotRatings }
  | { valid: false; reason: "invalid_ballot" };

export function validateBallotRatings(
  expectedPlayerIds: readonly string[],
  expectedCoachId: string,
  input: unknown,
): BallotValidationResult {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["playerRatings", "coachRating"])
  ) {
    return invalid();
  }
  const playerRatings = input.playerRatings;
  const coachRating = input.coachRating;
  if (
    !isRecord(playerRatings) ||
    !isRecord(coachRating) ||
    !hasExactKeys(coachRating, ["coachId", "rating"]) ||
    coachRating.coachId !== expectedCoachId ||
    !isRating(coachRating.rating)
  ) {
    return invalid();
  }

  const expected = [...new Set(expectedPlayerIds)].sort();
  if (expected.length !== expectedPlayerIds.length) return invalid();
  const submitted = Object.keys(playerRatings).sort();
  if (
    submitted.length !== expected.length ||
    submitted.some((id, index) => id !== expected[index]) ||
    Object.values(playerRatings).some((rating) => !isRating(rating))
  ) {
    return invalid();
  }

  return {
    valid: true,
    ratings: {
      playerRatings: playerRatings as Record<string, number>,
      coachRating: {
        coachId: expectedCoachId,
        rating: coachRating.rating,
      },
    },
  };
}

function isRating(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function invalid(): BallotValidationResult {
  return { valid: false, reason: "invalid_ballot" };
}
