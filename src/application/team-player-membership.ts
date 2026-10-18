import type {
  MatchParticipant,
  Player,
  TeamPlayerMembership,
} from "@/domain/models";
import {
  playerSearchPrefixes,
  normalizePlayerSearch,
} from "@/domain/player-search";

export function membershipFromPlayer(
  player: Player,
  observedAt: string,
): TeamPlayerMembership | null {
  if (!player.currentTeamId) return null;
  return {
    playerId: player.id,
    teamId: player.currentTeamId,
    displayName: player.displayName,
    searchName: normalizePlayerSearch(player.displayName),
    searchPrefixes: playerSearchPrefixes(player.displayName),
    source: "current_squad",
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    createdAt: observedAt,
    updatedAt: observedAt,
  };
}

export function membershipFromParticipant(
  participant: MatchParticipant,
): TeamPlayerMembership {
  return {
    playerId: participant.playerId,
    teamId: participant.teamId,
    displayName: participant.playerName,
    searchName: normalizePlayerSearch(participant.playerName),
    searchPrefixes: playerSearchPrefixes(participant.playerName),
    source:
      participant.participationProvenance === "operator_verified"
        ? "operator_verified"
        : "match_participant",
    sourceMatchId: participant.matchId,
    ...(participant.shirtNumber === undefined
      ? {}
      : { shirtNumber: participant.shirtNumber }),
    firstObservedAt: participant.createdAt,
    lastObservedAt: participant.updatedAt,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  };
}

export function mergeTeamPlayerMembership(
  existing: TeamPlayerMembership | undefined,
  incoming: TeamPlayerMembership,
): TeamPlayerMembership {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    firstObservedAt:
      existing.firstObservedAt < incoming.firstObservedAt
        ? existing.firstObservedAt
        : incoming.firstObservedAt,
    lastObservedAt:
      existing.lastObservedAt > incoming.lastObservedAt
        ? existing.lastObservedAt
        : incoming.lastObservedAt,
    createdAt: existing.createdAt,
    ...(incoming.shirtNumber === undefined && existing.shirtNumber !== undefined
      ? { shirtNumber: existing.shirtNumber }
      : {}),
  };
}
