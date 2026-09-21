import type { Ballot, MatchResult } from "./models";

export interface VoteComparisonRow {
  id: string;
  name: string;
  userRating: number;
  communityAverage: number;
  difference: number;
}

export interface VoteComparison {
  players: VoteComparisonRow[];
  coach: VoteComparisonRow;
}

export function compareVoteWithResult(
  ballot: Ballot,
  result: MatchResult,
  canonicalPlayerIds: ReadonlyMap<string, string>,
): VoteComparison | null {
  if (
    ballot.matchId !== result.matchId ||
    ballot.teamId !== result.teamId ||
    result.status !== "final" ||
    ballot.coachRating.coachId !== result.coachResult.coachId ||
    !validRating(ballot.coachRating.rating) ||
    !validAverage(result.coachResult.average)
  )
    return null;

  const resultsByCanonicalId = new Map<
    string,
    MatchResult["playerResults"][string]
  >();
  for (const player of Object.values(result.playerResults)) {
    const id = canonicalPlayerIds.get(player.playerId) ?? player.playerId;
    if (resultsByCanonicalId.has(id) || !validAverage(player.average))
      return null;
    resultsByCanonicalId.set(id, player);
  }

  const seen = new Set<string>();
  const players: VoteComparisonRow[] = [];
  for (const [playerId, userRating] of Object.entries(ballot.playerRatings)) {
    const id = canonicalPlayerIds.get(playerId) ?? playerId;
    const player = resultsByCanonicalId.get(id);
    if (!player || seen.has(id) || !validRating(userRating)) return null;
    seen.add(id);
    players.push({
      id: player.playerId,
      name: player.playerName,
      userRating,
      communityAverage: player.average,
      difference: userRating - player.average,
    });
  }
  if (players.length === 0 || players.length !== resultsByCanonicalId.size)
    return null;
  players.sort((left, right) => {
    const a = result.playerResults[left.id];
    const b = result.playerResults[right.id];
    return (
      b.average - a.average ||
      a.order - b.order ||
      left.id.localeCompare(right.id)
    );
  });
  return {
    players,
    coach: {
      id: result.coachResult.coachId,
      name: result.coachResult.coachName,
      userRating: ballot.coachRating.rating,
      communityAverage: result.coachResult.average,
      difference: ballot.coachRating.rating - result.coachResult.average,
    },
  };
}

function validRating(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 10;
}

function validAverage(value: number): boolean {
  return Number.isFinite(value) && value >= 1 && value <= 10;
}
