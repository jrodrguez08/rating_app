// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PublishedResultPodium } from "@/application/published-result-podium";
import { buildPublishedRatingStoryPages } from "@/application/published-rating-story";

import { PublishedRatingTableImage } from "./published-rating-table-image";

describe("published rating table Story image", () => {
  it("renders the match header, page number, long names, ratings, and shared MVPs", () => {
    const storyPage = buildPublishedRatingStoryPages(podium)[0];
    const markup = renderToStaticMarkup(
      <PublishedRatingTableImage
        podium={podium}
        storyPage={storyPage}
        siteHost="rating-app.test"
      />,
    );

    expect(markup).toContain("Calificaciones del partido");
    expect(markup).toContain("Herediano");
    expect(markup).toContain("Pérez Zeledón");
    expect(markup).toContain("2 - 1");
    expect(markup).toContain("19 oct 2026");
    expect(markup).toContain("1 / 1");
    expect(markup).toContain(
      "Jugador con un nombre extraordinariamente largo para validar el ajuste",
    );
    expect(markup).toContain("9,4");
    expect(markup.match(/MVP/g)).toHaveLength(2);
    expect(markup).toContain("Calificaciones de la afición");
    expect(markup).not.toContain("voter");
  });
});

const players = [
  {
    playerId: "player-1",
    displayName:
      "Jugador con un nombre extraordinariamente largo para validar el ajuste",
    average: 9.4,
    voteCount: 8,
    rank: 1,
    isMvp: true,
  },
  {
    playerId: "player-2",
    displayName: "Segundo jugador",
    average: 9.4,
    voteCount: 8,
    rank: 2,
    isMvp: true,
  },
];

const podium: PublishedResultPodium = {
  matchId: "match-1",
  homeTeam: { externalProviderId: "815", name: "Herediano" },
  awayTeam: { externalProviderId: "819", name: "Pérez Zeledón" },
  score: { home: 2, away: 1 },
  publishedMatchDate: "2026-10-20T02:00:00.000Z",
  generatedAt: "2026-10-20T05:00:00.000Z",
  players,
  topThree: players,
};
