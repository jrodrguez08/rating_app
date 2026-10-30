import {
  isPublicHistoricalMatch,
  isPublicUpcomingMatch,
  selectPublicMatch,
} from "@/application/public-match-selection";
import type { Match } from "@/domain/models";

export interface MatchArchiveItem {
  match: Match;
  competitionName?: string;
  hasResults: boolean;
}

export interface MatchArchive {
  relevant: MatchArchiveItem | null;
  recent: MatchArchiveItem[];
  upcoming: MatchArchiveItem[];
  featuredUpcoming: boolean;
}

export function buildMatchArchive(
  items: MatchArchiveItem[],
  now: Date,
): MatchArchive {
  const relevantMatch = selectPublicMatch(
    items.map(({ match }) => match),
    now,
  );
  const relevant =
    items.find(({ match }) => match.id === relevantMatch?.id) ?? null;
  const remainingItems = relevant
    ? items.filter(({ match }) => match.id !== relevant.match.id)
    : items;
  return {
    relevant,
    featuredUpcoming:
      relevant !== null && isPublicUpcomingMatch(relevant.match, now),
    recent: remainingItems
      .filter(({ match }) => isPublicHistoricalMatch(match))
      .sort(
        (left, right) =>
          new Date(right.match.kickoffAt).getTime() -
          new Date(left.match.kickoffAt).getTime(),
      ),
    upcoming: remainingItems
      .filter(({ match }) => isPublicUpcomingMatch(match, now))
      .sort(
        (left, right) =>
          new Date(left.match.kickoffAt).getTime() -
          new Date(right.match.kickoffAt).getTime(),
      ),
  };
}
