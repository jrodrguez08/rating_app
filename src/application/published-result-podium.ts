import type {
  Match,
  MatchResult,
  Player,
  PlayerPosition,
  PlayerResult,
} from "@/domain/models";

export const MAX_PUBLISHED_RESULT_PLAYERS = 30;

export interface PublishedPodiumPlayer {
  playerId: string;
  displayName: string;
  average: number;
  voteCount: number;
  rank: number;
  isMvp: boolean;
  position?: PlayerPosition;
  photoUrl?: string;
}

export interface PublishedResultPodium {
  matchId: string;
  homeTeam: Match["homeTeam"];
  awayTeam: Match["awayTeam"];
  score: { home: number; away: number };
  publishedMatchDate: string;
  generatedAt: string;
  players: PublishedPodiumPlayer[];
  topThree: PublishedPodiumPlayer[];
}

export function comparePublishedPlayerResults(
  left: PlayerResult,
  right: PlayerResult,
): number {
  return (
    right.average - left.average ||
    left.order - right.order ||
    left.playerId.localeCompare(right.playerId)
  );
}

export function buildPublishedResultPodium({
  match,
  result,
  identities,
  canonicalPlayerIds = new Map(),
}: {
  match: Match;
  result: MatchResult;
  identities: readonly Player[];
  canonicalPlayerIds?: ReadonlyMap<string, string>;
}): PublishedResultPodium | null {
  if (
    match.ratingState !== "rating_closed" ||
    result.status !== "final" ||
    result.ballotCount < 1 ||
    match.score.home === null ||
    match.score.away === null ||
    Object.keys(result.playerResults).length > MAX_PUBLISHED_RESULT_PLAYERS
  ) {
    return null;
  }

  const identitiesById = new Map(
    identities.map((player) => [player.id, player]),
  );
  const canonicalResults = new Map<
    string,
    { result: PlayerResult; sourcePlayerId: string }
  >();

  for (const player of Object.values(result.playerResults).sort(
    comparePublishedPlayerResults,
  )) {
    if (player.voteCount < 1 || player.average < 0 || player.average > 10) {
      continue;
    }
    const canonicalId =
      canonicalPlayerIds.get(player.playerId) ?? player.playerId;
    const existing = canonicalResults.get(canonicalId);
    if (existing !== undefined) {
      if (
        existing.result.average !== player.average ||
        existing.result.voteCount !== player.voteCount
      ) {
        return null;
      }
      if (
        player.playerId === canonicalId &&
        existing.sourcePlayerId !== canonicalId
      ) {
        canonicalResults.set(canonicalId, {
          result: player,
          sourcePlayerId: player.playerId,
        });
      }
      continue;
    }
    canonicalResults.set(canonicalId, {
      result: player,
      sourcePlayerId: player.playerId,
    });
  }

  const canonicalMvpIds = new Set(
    result.mvpPlayerIds.map(
      (playerId) => canonicalPlayerIds.get(playerId) ?? playerId,
    ),
  );
  const players = [...canonicalResults.entries()]
    .map(([playerId, entry]) => {
      const canonical = identitiesById.get(playerId);
      const source = identitiesById.get(entry.sourcePlayerId);
      const displayName =
        usableName(canonical?.displayName) ??
        usableName(source?.displayName) ??
        entry.result.playerName;
      const photoUrl = canonical?.photoUrl ?? source?.photoUrl;
      const position = canonical?.position ?? source?.position;
      return {
        playerId,
        displayName,
        average: entry.result.average,
        voteCount: entry.result.voteCount,
        order: entry.result.order,
        isMvp: canonicalMvpIds.has(playerId),
        ...(position === undefined ? {} : { position }),
        ...(photoUrl === undefined ? {} : { photoUrl }),
      };
    })
    .sort(
      (left, right) =>
        right.average - left.average ||
        left.order - right.order ||
        left.playerId.localeCompare(right.playerId),
    )
    .map((player, index) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      average: player.average,
      voteCount: player.voteCount,
      rank: index + 1,
      isMvp: player.isMvp,
      ...(player.position === undefined ? {} : { position: player.position }),
      ...(player.photoUrl === undefined ? {} : { photoUrl: player.photoUrl }),
    }));

  if (players.length === 0) return null;

  return {
    matchId: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    score: { home: match.score.home, away: match.score.away },
    publishedMatchDate: match.kickoffAt,
    generatedAt: result.generatedAt,
    players,
    topThree: players.slice(0, 3),
  };
}

function usableName(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
