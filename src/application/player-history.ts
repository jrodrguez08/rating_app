import type { Match, MatchResult, PlayerPosition } from "@/domain/models";

export const PLAYER_HISTORY_MATCH_LIMIT = 100;
export const PLAYER_RANKING_MIN_MATCHES = 2;

export interface PlayerIdentity {
  id: string;
  name: string;
  position?: PlayerPosition;
  photoUrl?: string;
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
  position?: PlayerPosition;
  photoUrl?: string;
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
  canonicalPlayerIds = new Map(),
}: {
  identities: PlayerIdentity[];
  matches: Match[];
  results: MatchResult[];
  trackedTeamExternalProviderId: string;
  canonicalPlayerIds?: ReadonlyMap<string, string>;
}): PlayerCatalog {
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const playersById = mergeCanonicalPlayerIdentities(
    identities,
    canonicalPlayerIds,
  );
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
      const playerId =
        canonicalPlayerIds.get(player.playerId) ?? player.playerId;
      if (!playersById.has(playerId)) {
        playersById.set(playerId, {
          id: playerId,
          name: player.playerName,
        });
      }
      const history = histories.get(playerId) ?? [];
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
      histories.set(playerId, history);
    }
  }

  const players: PlayerCatalogEntry[] = [...playersById.values()].map(
    ({ id: playerId, name: playerName, position, photoUrl }) => {
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
        ...(position === undefined ? {} : { position }),
        ...(photoUrl === undefined ? {} : { photoUrl }),
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

function mergeCanonicalPlayerIdentities(
  identities: readonly PlayerIdentity[],
  canonicalPlayerIds: ReadonlyMap<string, string>,
): Map<string, PlayerIdentity> {
  const players = new Map<string, PlayerIdentity>();
  const ordered = [...identities].sort((left, right) => {
    const leftCanonical = canonicalPlayerIds.get(left.id) ?? left.id;
    const rightCanonical = canonicalPlayerIds.get(right.id) ?? right.id;
    const leftPriority = left.id === leftCanonical ? 1 : 0;
    const rightPriority = right.id === rightCanonical ? 1 : 0;
    return leftPriority - rightPriority || left.id.localeCompare(right.id);
  });
  for (const identity of ordered) {
    const id = canonicalPlayerIds.get(identity.id) ?? identity.id;
    const current = players.get(id);
    const merged: PlayerIdentity = {
      id,
      name:
        identity.id === id ? identity.name : (current?.name ?? identity.name),
    };
    const position = identity.position ?? current?.position;
    const photoUrl = identity.photoUrl ?? current?.photoUrl;
    if (position !== undefined) merged.position = position;
    if (photoUrl !== undefined) merged.photoUrl = photoUrl;
    players.set(id, merged);
  }
  return players;
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
