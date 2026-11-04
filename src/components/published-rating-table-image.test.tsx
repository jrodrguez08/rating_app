// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PublishedResultPodium } from "@/application/published-result-podium";
import { buildPublishedRatingStoryPages } from "@/application/published-rating-story";
import { resolveClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";

import { PublishedPodiumImage } from "./published-podium-image";
import { PublishedRatingTableImage } from "./published-rating-table-image";

describe("published rating table Story image", () => {
  it.each(["es", "en"] as const)(
    "renders %s podium image text and ratings",
    (locale) => {
      const messages = getMessages(locale).results.image;
      const markup = renderToStaticMarkup(
        <PublishedPodiumImage
          club={resolveClub("saprissa")!}
          podium={podium}
          variant="open-graph"
          photoDataUrls={new Map()}
          siteHost="rating-app.test"
          locale={locale}
          messages={messages}
        />,
      );
      expect(markup).toContain(messages.openGraphHeading);
      expect(markup).toContain(messages.viewResults);
      expect(markup).toContain(locale === "es" ? "9,4" : "9.4");
      expect(markup).toContain("Deportivo Saprissa");
      expect(markup).toContain("Pérez Zeledón");
    },
  );
  it("renders the match header, page number, long names, ratings, and shared MVPs", () => {
    const storyPage = buildPublishedRatingStoryPages(podium)[0];
    const markup = renderToStaticMarkup(
      <PublishedRatingTableImage
        club={resolveClub("herediano")!}
        podium={podium}
        storyPage={storyPage}
        siteHost="rating-app.test"
        locale="es"
        messages={getMessages("es").results.image}
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

  it("renders English labels, dates, and decimal ratings for Saprissa", () => {
    const markup = renderToStaticMarkup(
      <PublishedRatingTableImage
        club={resolveClub("saprissa")!}
        podium={podium}
        storyPage={buildPublishedRatingStoryPages(podium)[0]}
        siteHost="rating-app.test"
        locale="en"
        messages={getMessages("en").results.image}
      />,
    );
    expect(markup).toContain("Match ratings");
    expect(markup).toContain("PLAYER");
    expect(markup).toContain("RATING");
    expect(markup).toContain("Ratings from the fans");
    expect(markup).toContain("9.4");
    expect(markup).toContain("Oct 19, 2026");
    expect(markup).not.toContain("Calificaciones del partido");
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
