import type {
  PublishedPodiumPlayer,
  PublishedResultPodium,
} from "@/application/published-result-podium";

export const RATING_STORY_PLAYERS_PER_PAGE = 16;

export interface PublishedRatingStoryPage {
  page: number;
  pageCount: number;
  players: readonly PublishedPodiumPlayer[];
}

export function buildPublishedRatingStoryPages(
  podium: PublishedResultPodium,
): PublishedRatingStoryPage[] {
  if (podium.players.length === 0) return [];
  const pageCount = Math.ceil(
    podium.players.length / RATING_STORY_PLAYERS_PER_PAGE,
  );
  const basePageSize = Math.floor(podium.players.length / pageCount);
  const largerPageCount = podium.players.length % pageCount;
  let start = 0;

  return Array.from({ length: pageCount }, (_, index) => {
    const size = basePageSize + (index < largerPageCount ? 1 : 0);
    const players = podium.players.slice(start, start + size);
    start += size;
    return { page: index + 1, pageCount, players };
  });
}

export function publishedRatingStoryFilename(
  matchId: string,
  page: number,
  pageCount: number,
): string {
  const safeMatchId = matchId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `rating-app-${safeMatchId}-calificaciones-${page}-de-${pageCount}.png`;
}
