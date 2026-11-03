import type { Coach } from "@/domain/models";
import { playerSearchPrefixes } from "@/domain/player-search";

export const COACH_SEARCH_INDEX_VERSION = 2;

export function coachWithSearchIndex(
  coach: Coach,
  associatedTeamIds: readonly string[] = coach.associatedTeamIds ?? [],
  hiddenByAlias = coach.searchHiddenByAlias ?? false,
): Coach {
  const teams = [...new Set(associatedTeamIds)].sort();
  const prefixes = playerSearchPrefixes(coach.displayName);
  return {
    ...coach,
    associatedTeamIds: teams,
    searchHiddenByAlias: hiddenByAlias,
    searchPrefixes: hiddenByAlias ? [] : prefixes,
    teamBrowseKeys: hiddenByAlias ? [] : teams,
    teamSearchKeys: hiddenByAlias
      ? []
      : teams.flatMap((teamId) =>
          prefixes.map((prefix) => `${teamId}:${prefix}`),
        ),
    unassociatedSearchKeys: hiddenByAlias || teams.length > 0 ? [] : prefixes,
  };
}
