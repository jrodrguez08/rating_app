import type { Match, MatchResult, PlayerPosition } from "@/domain/models";

export const PLAYER_RANKING_MIN_MATCHES = 2;
export const PLAYER_RANKING_PRIOR_MATCH_WEIGHT = 3;
export const PLAYER_TREND_STABILITY_THRESHOLD = 0.2;

export type PlayerRatingTrendDirection = "improving" | "declining" | "stable";

export interface PlayerRatingTrend {
  direction: PlayerRatingTrendDirection;
  delta: number;
  recentAverage: number;
  previousAverage: number;
}

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
  rankingScore: number | null;
  ratedMatchCount: number;
  rank: number | null;
  recentRating: number | null;
  trend: PlayerRatingTrend | null;
  history: PlayerMatchRating[];
}

export interface PlayerCatalog {
  players: PlayerCatalogEntry[];
  rankingMinimumMatches: number;
  rankingPriorMatchWeight: number;
  referenceMean: number | null;
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
  let referenceRatingTotal = 0;
  let referenceRatingCount = 0;

  for (const result of results) {
    const match = matchesById.get(result.matchId);
    const trackedTeamIsHome =
      match?.homeTeam.externalProviderId === trackedTeamExternalProviderId;
    const trackedTeamIsAway =
      match?.awayTeam.externalProviderId === trackedTeamExternalProviderId;
    if (
      match?.ratingState !== "rating_closed" ||
      result.status !== "final" ||
      result.teamId !== match.trackedTeamId ||
      trackedTeamIsHome === trackedTeamIsAway ||
      !Number.isFinite(new Date(match.kickoffAt).getTime())
    ) {
      continue;
    }
    const canonicalResults = new Map<
      string,
      MatchResult["playerResults"][string]
    >();
    for (const player of Object.values(result.playerResults)) {
      if (!isValidPlayerMatchResult(player, result.ballotCount)) continue;
      const playerId =
        canonicalPlayerIds.get(player.playerId) ?? player.playerId;
      const existing = canonicalResults.get(playerId);
      if (existing !== undefined) {
        if (
          existing.average !== player.average ||
          existing.voteCount !== player.voteCount
        ) {
          throw new Error(
            `MatchResult ${result.matchId} contains conflicting ratings for canonical Player ${playerId}.`,
          );
        }
        if (player.playerId === playerId && existing.playerId !== playerId) {
          canonicalResults.set(playerId, player);
        }
        continue;
      }
      canonicalResults.set(playerId, player);
    }
    for (const [playerId, player] of canonicalResults) {
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
        opponentName: trackedTeamIsHome
          ? match.awayTeam.name
          : match.homeTeam.name,
        homeTeamName: match.homeTeam.name,
        awayTeamName: match.awayTeam.name,
        score: match.score,
        average: player.average,
        voteCount: player.voteCount,
      });
      histories.set(playerId, history);
      referenceRatingTotal += player.average;
      referenceRatingCount += 1;
    }
  }

  const referenceMean =
    referenceRatingCount === 0
      ? null
      : referenceRatingTotal / referenceRatingCount;

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
      const rankingScore =
        overallAverage === null ||
        history.length < PLAYER_RANKING_MIN_MATCHES ||
        referenceMean === null
          ? null
          : adjustedPlayerRating(history.length, overallAverage, referenceMean);
      return {
        playerId,
        playerName,
        ...(position === undefined ? {} : { position }),
        ...(photoUrl === undefined ? {} : { photoUrl }),
        overallAverage,
        rankingScore,
        ratedMatchCount: history.length,
        rank: null,
        recentRating: history[0]?.average ?? null,
        trend: playerRatingTrend(history),
        history,
      };
    },
  );

  const eligible = players
    .filter((player) => player.rankingScore !== null)
    .sort(compareRankedPlayers);
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
      return compareUnrankedPlayers(left, right);
    return (
      left.playerName.localeCompare(right.playerName) ||
      left.playerId.localeCompare(right.playerId)
    );
  });
  return {
    players,
    rankingMinimumMatches: PLAYER_RANKING_MIN_MATCHES,
    rankingPriorMatchWeight: PLAYER_RANKING_PRIOR_MATCH_WEIGHT,
    referenceMean,
  };
}

export function adjustedPlayerRating(
  ratedMatchCount: number,
  rawMatchAverage: number,
  referenceMean: number,
): number {
  return (
    (ratedMatchCount * rawMatchAverage +
      PLAYER_RANKING_PRIOR_MATCH_WEIGHT * referenceMean) /
    (ratedMatchCount + PLAYER_RANKING_PRIOR_MATCH_WEIGHT)
  );
}

export function playerRatingTrend(
  history: readonly PlayerMatchRating[],
): PlayerRatingTrend | null {
  if (history.length < 6) return null;
  const latestSix = [...history].sort(compareChronologicalRatings).slice(-6);
  const previousAverage = averageRatings(latestSix.slice(0, 3));
  const recentAverage = averageRatings(latestSix.slice(3));
  const delta = recentAverage - previousAverage;
  return {
    direction: greaterThanThreshold(delta, PLAYER_TREND_STABILITY_THRESHOLD)
      ? "improving"
      : greaterThanThreshold(-delta, PLAYER_TREND_STABILITY_THRESHOLD)
        ? "declining"
        : "stable",
    delta,
    recentAverage,
    previousAverage,
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

function compareRankedPlayers(
  left: PlayerCatalogEntry,
  right: PlayerCatalogEntry,
): number {
  return (
    (right.rankingScore ?? -1) - (left.rankingScore ?? -1) ||
    (right.overallAverage ?? -1) - (left.overallAverage ?? -1) ||
    right.ratedMatchCount - left.ratedMatchCount ||
    left.playerId.localeCompare(right.playerId)
  );
}

function compareUnrankedPlayers(
  left: PlayerCatalogEntry,
  right: PlayerCatalogEntry,
): number {
  return (
    (right.overallAverage ?? -1) - (left.overallAverage ?? -1) ||
    right.ratedMatchCount - left.ratedMatchCount ||
    left.playerId.localeCompare(right.playerId)
  );
}

function compareChronologicalRatings(
  left: PlayerMatchRating,
  right: PlayerMatchRating,
): number {
  return (
    new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime() ||
    left.matchId.localeCompare(right.matchId)
  );
}

function averageRatings(ratings: readonly PlayerMatchRating[]): number {
  return (
    ratings.reduce((total, rating) => total + rating.average, 0) /
    ratings.length
  );
}

function greaterThanThreshold(value: number, threshold: number): boolean {
  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(threshold)) * 8;
  return value - threshold > tolerance;
}

function isValidPlayerMatchResult(
  player: MatchResult["playerResults"][string],
  ballotCount: number,
): boolean {
  return (
    typeof player.playerId === "string" &&
    player.playerId.length > 0 &&
    typeof player.playerName === "string" &&
    player.playerName.length > 0 &&
    Number.isFinite(player.average) &&
    player.average >= 1 &&
    player.average <= 10 &&
    Number.isInteger(player.voteCount) &&
    player.voteCount > 0 &&
    Number.isInteger(ballotCount) &&
    ballotCount > 0 &&
    player.voteCount === ballotCount &&
    Number.isInteger(player.order) &&
    player.order >= 0
  );
}
