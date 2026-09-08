import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getAllByText(/Not ranked yet/)).not.toHaveLength(0);
  });

  it("renders persisted position and photo, then falls back deterministically on failure", () => {
    render(
      <PlayerCatalogView
        catalog={{
          rankingMinimumMatches: 2,
          historyMatchLimit: 100,
          players: [
            player({
              playerName: "John Smith",
              position: "defender",
              photoUrl: "https://media.api-sports.io/football/players/101.png",
            }),
          ],
        }}
        messages={messages}
      />,
    );

    expect(screen.getByText("Defender")).toBeInTheDocument();
    const avatar = screen.getByRole("img", { name: "Avatar for John Smith" });
    const image = avatar.querySelector("img");
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(screen.getByText("JS")).toBeInTheDocument();
  });

  it("uses initials when a photo is missing and localizes profile position", () => {
    render(
      <PlayerProfile
        player={player({ playerName: "Orlando", position: "attacker" })}
        locale="en"
        messages={messages}
      />,
    );
    expect(screen.getByText("O")).toBeInTheDocument();
    expect(screen.getByText("Attacker")).toBeInTheDocument();
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
    expect(
      screen.queryByRole("group", { name: /rating evolution/i }),
    ).not.toBeInTheDocument();
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

  it("renders the fixed rating scale, guides, and accessible match points", () => {
    render(
      <PlayerProfile
        player={player({
          ratedMatchCount: 2,
          history: [
            history(),
            history({
              matchId: "match-0",
              kickoffAt: "2026-08-23T17:00:00.000Z",
              opponentName: "Earlier Opponent",
              average: 7,
            }),
          ],
        })}
        locale="en"
        messages={messages}
      />,
    );

    const chart = screen.getByRole("group", { name: /rating evolution/i });
    expect(within(chart).getByText("10")).toBeInTheDocument();
    expect(within(chart).getByText("5")).toBeInTheDocument();
    expect(within(chart).getByText("1")).toBeInTheDocument();
    expect(within(chart).getAllByTestId("rating-guide")).toHaveLength(3);
    expect(within(chart).getAllByTestId("rating-point")).toHaveLength(2);
    expect(within(chart).getAllByTestId("rating-axis-label")).toHaveLength(2);
    expect(within(chart).getByText("8/23")).toBeInTheDocument();
    expect(within(chart).getByText("8/30")).toBeInTheDocument();

    const latestPoint = within(chart).getByRole("img", {
      name: /vs Opponent, Aug 30, 2026: rating 8\.0/i,
    });
    expect(latestPoint).toHaveAttribute("tabindex", "0");
    latestPoint.focus();
    expect(latestPoint).toHaveFocus();
    expect(within(chart).getByText("Rating 8.0")).toBeInTheDocument();
    expect(within(chart).getByText("vs Earlier Opponent")).toBeInTheDocument();
  });

  it("thins dense date labels and keeps the chart bounded on narrow layouts", () => {
    const denseHistory = Array.from({ length: 8 }, (_, index) =>
      history({
        matchId: `match-${index}`,
        kickoffAt: `2026-08-${String(index + 1).padStart(2, "0")}T17:00:00.000Z`,
        opponentName: `Opponent ${index + 1}`,
        average: index + 1,
      }),
    ).reverse();
    render(
      <PlayerProfile
        player={player({ ratedMatchCount: 8, history: denseHistory })}
        locale="en"
        messages={messages}
      />,
    );

    const chart = screen.getByRole("group", { name: /rating evolution/i });
    expect(within(chart).getAllByTestId("rating-point")).toHaveLength(8);
    expect(within(chart).getAllByTestId("rating-axis-label")).toHaveLength(4);
    expect(chart).toHaveAttribute("viewBox", "0 0 320 152");
    expect(chart).toHaveClass("w-full", "max-w-full");
    expect(chart.parentElement).toHaveClass("overflow-hidden");
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
