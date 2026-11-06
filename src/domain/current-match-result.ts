import type { Match, MatchResult } from "@/domain/models";

export function isCompatibleCurrentResult(
  match: Match,
  result: MatchResult,
): boolean {
  if (
    result.matchId !== match.id ||
    result.teamId !== match.trackedTeamId ||
    !Number.isInteger(result.ballotCount) ||
    result.ballotCount < 0 ||
    (result.status !== "final" && result.status !== "no_votes") ||
    typeof result.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(result.generatedAt)) ||
    !isRecord(result.playerResults) ||
    !isRecord(result.coachResult) ||
    !Array.isArray(result.mvpPlayerIds)
  ) {
    return false;
  }
  const playerResults = Object.entries(result.playerResults);
  if (playerResults.length === 0) return false;
  const orders = new Set<number>();
  for (const [playerId, value] of playerResults) {
    if (
      !isRecord(value) ||
      value.playerId !== playerId ||
      typeof value.playerName !== "string" ||
      value.playerName.length === 0 ||
      !validAggregateRating(value.average) ||
      value.voteCount !== result.ballotCount ||
      !Number.isInteger(value.order) ||
      (value.order as number) < 0 ||
      orders.has(value.order as number)
    ) {
      return false;
    }
    orders.add(value.order as number);
  }
  const coach = result.coachResult;
  if (
    typeof coach.coachId !== "string" ||
    coach.coachId.length === 0 ||
    typeof coach.coachName !== "string" ||
    coach.coachName.length === 0 ||
    !validAggregateRating(coach.average) ||
    coach.voteCount !== result.ballotCount
  ) {
    return false;
  }
  if (
    result.mvpPlayerIds.some(
      (playerId) =>
        typeof playerId !== "string" || !(playerId in result.playerResults),
    ) ||
    new Set(result.mvpPlayerIds).size !== result.mvpPlayerIds.length
  ) {
    return false;
  }
  return result.status === "no_votes"
    ? result.ballotCount === 0 && result.mvpPlayerIds.length === 0
    : result.ballotCount > 0 && result.mvpPlayerIds.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validAggregateRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10
  );
}
