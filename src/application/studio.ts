import type { PublishedResultPodium } from "@/application/published-result-podium";
import type { Match, MatchResult } from "@/domain/models";

export const MAX_STUDIO_MATCH_OPTIONS = 20;

export interface StudioMatchOption {
  matchId: string;
  kickoffAt: string;
  homeTeamName: string;
  awayTeamName: string;
  score: { home: number; away: number };
}

export interface StudioMatchPresentation {
  match: Match;
  result: MatchResult;
  podium: PublishedResultPodium;
  playerAverage: number;
  highestRatedPlayer: PublishedResultPodium["players"][number];
  lowestRatedPlayer: PublishedResultPodium["players"][number];
}

export function buildStudioMatchPresentation(
  match: Match,
  result: MatchResult,
  podium: PublishedResultPodium | null,
): StudioMatchPresentation | null {
  if (
    podium === null ||
    podium.matchId !== match.id ||
    result.matchId !== match.id ||
    result.teamId !== match.trackedTeamId ||
    podium.players.length === 0
  ) {
    return null;
  }

  return {
    match,
    result,
    podium,
    playerAverage:
      podium.players.reduce((total, player) => total + player.average, 0) /
      podium.players.length,
    highestRatedPlayer: podium.players[0],
    lowestRatedPlayer: podium.players.at(-1)!,
  };
}
