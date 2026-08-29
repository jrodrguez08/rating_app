import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Match, MatchResult } from "@/domain/models";
import { getMessages } from "@/i18n/messages";

import { MatchResults, ResultRouteState } from "./match-results";

describe("match results UI", () => {
  it.each([
    ["es" as const, "Resultados bloqueados", "cuando cierre la votación"],
    ["en" as const, "Results locked", "after voting closes"],
  ])("renders the safe pre-close state in %s", (locale, title, description) => {
    render(
      <ResultRouteState
        state="locked"
        messages={getMessages(locale).results}
      />,
    );
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(description, "i"))).toBeInTheDocument();
    expect(screen.queryByText(/8\.\d/)).not.toBeInTheDocument();
  });

  it("renders an honest pending state", () => {
    render(
      <ResultRouteState
        state="preparing"
        messages={getMessages("en").results}
      />,
    );
    expect(
      screen.getByText("We're preparing the results."),
    ).toBeInTheDocument();
  });

  it("renders sorted players, tied MVPs, coach, count, and one decimal", () => {
    render(
      <MatchResults
        match={match}
        result={result}
        locale="en"
        messages={getMessages("en").results}
      />,
    );
    expect(screen.getByText("Joint MVP")).toBeInTheDocument();
    const ranking = screen.getByRole("list");
    const items = within(ranking).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Long Player Name That Wraps");
    expect(items[1]).toHaveTextContent("Second Player");
    expect(screen.getAllByText("8.5").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("heading", { name: "Head coach" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Coach Name")).toBeInTheDocument();
    expect(screen.getByText("Based on 2 votes")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("voter-");
  });

  it("renders a zero-vote result without rankings", () => {
    render(
      <MatchResults
        match={match}
        result={{
          ...result,
          status: "no_votes",
          ballotCount: 0,
          mvpPlayerIds: [],
        }}
        locale="es"
        messages={getMessages("es").results}
      />,
    );
    expect(
      screen.getByText("No hubo suficientes votos para mostrar resultados."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

const match: Match = {
  id: "match-1",
  trackedTeamId: "team-1",
  competitionId: "competition",
  seasonId: "season",
  homeTeam: { externalProviderId: "815", name: "Herediano" },
  awayTeam: { externalProviderId: "2", name: "Opponent" },
  kickoffAt: "2026-08-29T16:00:00.000Z",
  status: "finished",
  ratingState: "rating_closed",
  score: { home: 2, away: 1 },
  externalProvider: "api-football",
  externalProviderFixtureId: "1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-29T20:00:00.000Z",
};
const result: MatchResult = {
  matchId: "match-1",
  teamId: "team-1",
  ballotCount: 2,
  status: "final",
  playerResults: {
    p1: {
      playerId: "p1",
      playerName: "Long Player Name That Wraps",
      average: 8.5,
      voteCount: 2,
      order: 0,
    },
    p2: {
      playerId: "p2",
      playerName: "Second Player",
      average: 8.5,
      voteCount: 2,
      order: 1,
    },
  },
  coachResult: {
    coachId: "coach-1",
    coachName: "Coach Name",
    average: 7,
    voteCount: 2,
  },
  mvpPlayerIds: ["p1", "p2"],
  generatedAt: "2026-08-29T20:00:00.000Z",
};
