import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PlayerCatalogEntry } from "@/application/player-history";
import { getMessages } from "@/i18n/messages";

import { PlayerCatalogView, PlayerProfile } from "./player-history";

const messages = getMessages("en").players;

describe("player history UI", () => {
  it("renders ranked and unranked catalog entries as stable profile links", () => {
    render(
      <PlayerCatalogView
        catalog={{
          rankingMinimumMatches: 2,
          historyMatchLimit: 100,
          players: [
            player(),
            player({
              playerId: "new",
              playerName: "New Player",
              rank: null,
              ratedMatchCount: 1,
            }),
          ],
        }}
        messages={messages}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Players" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Rated Player/ })).toHaveAttribute(
      "href",
      "/players/player-1",
    );
    expect(screen.getByText(/Not ranked yet/)).toBeInTheDocument();
  });

  it("renders one-match history without a misleading trend and links to results", () => {
    render(
      <PlayerProfile
        player={player({ rank: null, ratedMatchCount: 1 })}
        locale="en"
        messages={messages}
      />,
    );

    expect(
      screen.getByText("One more published match is needed to show a trend."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View results/ })).toHaveAttribute(
      "href",
      "/matches/match-1/results",
    );
    expect(screen.getByText("vs Opponent")).toBeInTheDocument();
  });

  it("renders a known-player empty state", () => {
    render(
      <PlayerProfile
        player={player({
          overallAverage: null,
          recentRating: null,
          ratedMatchCount: 0,
          rank: null,
          history: [],
        })}
        locale="en"
        messages={messages}
      />,
    );

    expect(
      screen.getByText(/has no published ratings yet/),
    ).toBeInTheDocument();
  });

  it("renders a lightweight accessible multi-match evolution graphic", () => {
    render(
      <PlayerProfile
        player={player({
          ratedMatchCount: 2,
          history: [history(), history({ matchId: "match-0", average: 7 })],
        })}
        locale="en"
        messages={messages}
      />,
    );

    expect(
      screen.getByRole("img", { name: /rating evolution/i }),
    ).toBeInTheDocument();
  });
});

function player(
  overrides: Partial<PlayerCatalogEntry> = {},
): PlayerCatalogEntry {
  return {
    playerId: "player-1",
    playerName: "Rated Player",
    overallAverage: 8,
    ratedMatchCount: 2,
    rank: 1,
    recentRating: 8,
    history: [history()],
    ...overrides,
  };
}

function history(
  overrides: Partial<PlayerCatalogEntry["history"][number]> = {},
) {
  return {
    matchId: "match-1",
    kickoffAt: "2026-08-30T17:00:00.000Z",
    opponentName: "Opponent",
    homeTeamName: "Opponent",
    awayTeamName: "Herediano",
    score: { home: 1, away: 2 },
    average: 8,
    voteCount: 2,
    ...overrides,
  };
}
