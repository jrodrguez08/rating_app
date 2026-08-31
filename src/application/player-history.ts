import type { Match, MatchResult } from "@/domain/models";

export const PLAYER_HISTORY_MATCH_LIMIT = 100;
export const PLAYER_RANKING_MIN_MATCHES = 2;

export interface PlayerIdentity {
  id: string;
  name: string;
}

export interface PlayerMatchRating {
  matchId: string;
  kickoffAt: string;
  opponentName: string;
  homeTeamName: string;
  awayTeamName: string;
  score: Match["score"];
  average: number;
  voteCount: number;
}

export interface PlayerCatalogEntry {
  playerId: string;
  playerName: string;
  overallAverage: number | null;
  ratedMatchCount: number;
  rank: number | null;
  recentRating: number | null;
  history: PlayerMatchRating[];
}

export interface PlayerCatalog {
  players: PlayerCatalogEntry[];
  rankingMinimumMatches: number;
  historyMatchLimit: number;
}

export function buildPlayerCatalog({
  identities,
  matches,
  results,
  trackedTeamExternalProviderId,
}: {
  identities: PlayerIdentity[];
  matches: Match[];
  results: MatchResult[];
  trackedTeamExternalProviderId: string;
}): PlayerCatalog {
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const names = new Map(identities.map(({ id, name }) => [id, name]));
  const histories = new Map<string, PlayerMatchRating[]>();

  for (const result of results) {
    const match = matchesById.get(result.matchId);
    if (
      match?.ratingState !== "rating_closed" ||
      result.status !== "final" ||
      result.teamId !== match.trackedTeamId
    ) {
      continue;
    }
    for (const player of Object.values(result.playerResults)) {
      if (!names.has(player.playerId))
        names.set(player.playerId, player.playerName);
      const history = histories.get(player.playerId) ?? [];
      history.push({
        matchId: match.id,
        kickoffAt: match.kickoffAt,
        opponentName:
          match.homeTeam.externalProviderId === trackedTeamExternalProviderId
            ? match.awayTeam.name
            : match.homeTeam.name,
        homeTeamName: match.homeTeam.name,
        awayTeamName: match.awayTeam.name,
        score: match.score,
        average: player.average,
        voteCount: player.voteCount,
      });
      histories.set(player.playerId, history);
    }
  }

  const players: PlayerCatalogEntry[] = [...names.entries()].map(
    ([playerId, playerName]) => {
      const history = (histories.get(playerId) ?? []).sort(
        (left, right) =>
          new Date(right.kickoffAt).getTime() -
            new Date(left.kickoffAt).getTime() ||
          left.matchId.localeCompare(right.matchId),
      );
      const overallAverage =
        history.length === 0
          ? null
          : history.reduce((sum, rating) => sum + rating.average, 0) /
            history.length;
      return {
        playerId,
        playerName,
        overallAverage,
        ratedMatchCount: history.length,
        rank: null,
        recentRating: history[0]?.average ?? null,
        history,
      };
    },
  );

  const eligible = players
    .filter((player) => player.ratedMatchCount >= PLAYER_RANKING_MIN_MATCHES)
    .sort(compareRatedPlayers);
  eligible.forEach((player, index) => {
    player.rank = index + 1;
  });

  players.sort((left, right) => {
    if (left.rank !== null || right.rank !== null)
      return (
        (left.rank ?? Number.MAX_SAFE_INTEGER) -
        (right.rank ?? Number.MAX_SAFE_INTEGER)
      );
    if (left.overallAverage !== null || right.overallAverage !== null)
      return compareRatedPlayers(left, right);
    return (
      left.playerName.localeCompare(right.playerName) ||
      left.playerId.localeCompare(right.playerId)
    );
  });
  return {
    players,
    rankingMinimumMatches: PLAYER_RANKING_MIN_MATCHES,
    historyMatchLimit: PLAYER_HISTORY_MATCH_LIMIT,
  };
}

function compareRatedPlayers(
  left: PlayerCatalogEntry,
  right: PlayerCatalogEntry,
): number {
  return (
    (right.overallAverage ?? -1) - (left.overallAverage ?? -1) ||
    right.ratedMatchCount - left.ratedMatchCount ||
    left.playerId.localeCompare(right.playerId)
  );
}
