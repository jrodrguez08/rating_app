import type { MatchStatus, RatingState } from "@/domain/models";

export function preserveMonotonicMatchStatus(
  current: MatchStatus,
  incoming: MatchStatus,
  ratingState: RatingState,
): MatchStatus {
  if (ratingState === "rating_ready" || ratingState === "rating_closed") {
    return current;
  }

  const rank: Partial<Record<MatchStatus, number>> = {
    scheduled: 0,
    live: 1,
    finished: 2,
  };
  const currentRank = rank[current];
  const incomingRank = rank[incoming];
  if (currentRank !== undefined && incomingRank !== undefined) {
    return incomingRank >= currentRank ? incoming : current;
  }
  return incoming;
}
