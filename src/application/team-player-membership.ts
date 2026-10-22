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
  if (!existing) {
    return {
      ...incoming,
      searchPrefixes: [...new Set(incoming.searchPrefixes)]
        .sort()
        .slice(0, 160),
    };
  }
  const presentation =
    incoming.lastObservedAt >= existing.lastObservedAt ? incoming : existing;
  const evidence =
    membershipSourceRank(incoming.source) >=
    membershipSourceRank(existing.source)
      ? incoming
      : existing;
  const combined = { ...existing, ...incoming };
  const searchPrefixes = [
    ...new Set([...existing.searchPrefixes, ...incoming.searchPrefixes]),
  ]
    .sort()
    .slice(0, 160);
  delete combined.sourceMatchId;
  delete combined.shirtNumber;
  return {
    ...combined,
    displayName: presentation.displayName,
    searchName: presentation.searchName,
    searchPrefixes,
    source: evidence.source,
    ...(evidence.sourceMatchId
      ? { sourceMatchId: evidence.sourceMatchId }
      : {}),
    firstObservedAt:
      existing.firstObservedAt < incoming.firstObservedAt
        ? existing.firstObservedAt
        : incoming.firstObservedAt,
    lastObservedAt:
      existing.lastObservedAt > incoming.lastObservedAt
        ? existing.lastObservedAt
        : incoming.lastObservedAt,
    createdAt: existing.createdAt,
    updatedAt:
      existing.updatedAt > incoming.updatedAt
        ? existing.updatedAt
        : incoming.updatedAt,
    ...(presentation.shirtNumber === undefined
      ? existing.shirtNumber === undefined
        ? {}
        : { shirtNumber: existing.shirtNumber }
      : { shirtNumber: presentation.shirtNumber }),
  };
}

function membershipSourceRank(source: TeamPlayerMembership["source"]): number {
  switch (source) {
    case "operator_verified":
      return 3;
    case "match_participant":
      return 2;
    case "provider_observation":
      return 1;
    case "current_squad":
      return 0;
  }
}
