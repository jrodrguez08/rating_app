export interface RatingFraction {
  numerator: bigint;
  denominator: bigint;
}

function ratingFraction(
  numerator: bigint,
  denominator: bigint,
): RatingFraction {
  let a = numerator < BigInt(0) ? -numerator : numerator;
  let b = denominator;
  while (b !== BigInt(0)) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

export function reconstructRating(
  average: number,
  votes: number,
): RatingFraction | null {
  if (
    !Number.isFinite(average) ||
    average < 1 ||
    average > 10 ||
    !Number.isSafeInteger(votes) ||
    votes < 1
  )
    return null;
  const product = average * votes;
  const sum = Math.round(product);
  const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(product));
  return Number.isSafeInteger(sum) &&
    tolerance < 0.5 &&
    Math.abs(product - sum) <= tolerance
    ? ratingFraction(BigInt(sum), BigInt(votes))
    : null;
}

export function meanRating(ratings: readonly RatingFraction[]): RatingFraction {
  const sum = ratings.reduce(
    (a, b) =>
      ratingFraction(
        a.numerator * b.denominator + b.numerator * a.denominator,
        a.denominator * b.denominator,
      ),
    ratingFraction(BigInt(0), BigInt(1)),
  );
  return ratingFraction(
    sum.numerator,
    sum.denominator * BigInt(ratings.length),
  );
}

export function compareRatings(a: RatingFraction, b: RatingFraction): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

export function serializeRating(rating: RatingFraction) {
  return {
    numerator: String(rating.numerator),
    denominator: String(rating.denominator),
  };
}
