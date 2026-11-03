import { describe, expect, it } from "vitest";

import type { PublishedResultPodium } from "./published-result-podium";
import {
  buildPublishedRatingStoryPages,
  publishedRatingStoryFilename,
  RATING_STORY_PLAYERS_PER_PAGE,
} from "./published-rating-story";

describe("published rating Story pagination", () => {
  it.each([11, 14, 16])("keeps %s players on one Story", (playerCount) => {
    const pages = buildPublishedRatingStoryPages(podium(playerCount));

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ page: 1, pageCount: 1 });
    expect(pages[0].players).toHaveLength(playerCount);
  });

  it("starts a second Story one player above capacity", () => {
    const pages = buildPublishedRatingStoryPages(
      podium(RATING_STORY_PLAYERS_PER_PAGE + 1),
    );

    expect(pages).toHaveLength(2);
    expect(pages.map(({ page, pageCount }) => ({ page, pageCount }))).toEqual([
      { page: 1, pageCount: 2 },
      { page: 2, pageCount: 2 },
    ]);
    expect(pages[0].players).toHaveLength(9);
    expect(pages[1].players).toHaveLength(8);
  });

  it("preserves every canonical player, rating, rank, and MVP flag exactly once", () => {
    const source = podium(30);
    const pages = buildPublishedRatingStoryPages(source);
    const flattened = pages.flatMap(({ players }) => players);

    expect(flattened).toEqual(source.players);
    expect(new Set(flattened.map(({ playerId }) => playerId)).size).toBe(30);
    expect(flattened[0]).toMatchObject({
      rank: 1,
      average: 10,
      isMvp: true,
    });
    expect(flattened.at(-1)).toMatchObject({ rank: 30, average: 7.1 });
  });

  it("creates a safe, page-specific filename", () => {
    expect(
      publishedRatingStoryFilename("saprissa", "match/unsafe id", 2, 2),
    ).toBe("rating-app-saprissa-match-unsafe-id-calificaciones-2-de-2.png");
  });
});

function podium(playerCount: number): PublishedResultPodium {
  const players = Array.from({ length: playerCount }, (_, index) => ({
    playerId: `player-${String(index + 1).padStart(2, "0")}`,
    displayName:
      index === 3
        ? "Jugador con un nombre extraordinariamente largo"
        : `Jugador ${index + 1}`,
    average: 10 - index / 10,
    voteCount: 7,
    rank: index + 1,
    isMvp: index < 2,
  }));
  return {
    matchId: "match-1",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "819", name: "Pérez Zeledón" },
    score: { home: 2, away: 1 },
    publishedMatchDate: "2026-10-20T02:00:00.000Z",
    generatedAt: "2026-10-20T05:00:00.000Z",
    players,
    topThree: players.slice(0, 3),
  };
}
