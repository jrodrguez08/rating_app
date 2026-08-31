import { selectRelevantMatch } from "@/application/match-lifecycle";
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
}

export function buildMatchArchive(
  items: MatchArchiveItem[],
  now: Date,
): MatchArchive {
  const relevantMatch = selectRelevantMatch(
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
    recent: remainingItems
      .filter(({ match }) => match.status === "finished")
      .sort(
        (left, right) =>
          new Date(right.match.kickoffAt).getTime() -
          new Date(left.match.kickoffAt).getTime(),
      ),
    upcoming: remainingItems
      .filter(({ match }) => match.status !== "finished")
      .sort(
        (left, right) =>
          new Date(left.match.kickoffAt).getTime() -
          new Date(right.match.kickoffAt).getTime(),
      ),
  };
}
