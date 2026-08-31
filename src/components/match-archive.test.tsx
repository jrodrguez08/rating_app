import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MatchArchiveItem } from "@/application/match-archive";
import type { Match } from "@/domain/models";
import { getMessages } from "@/i18n/messages";

import { formatGoalMinute, GoalSummary, MatchCard } from "./match-archive";

const messages = getMessages("en").matches;
const now = new Date("2026-08-31T12:00:00.000Z");

describe("Partidos presentation", () => {
  it.each([
    ["scheduled", match(), "Next match", "View match"],
    [
      "live",
      match({ status: "live", score: { home: 1, away: 0 }, elapsedMinute: 63 }),
      "Live · 63'",
      "1 - 0",
    ],
    [
      "preparing",
      match({
        status: "finished",
        ratingState: "preparing_rating",
        score: { home: 1, away: 0 },
      }),
      "Preparing ratings",
      "We're preparing the ratings.",
    ],
    [
      "historical",
      match({
        id: "historical",
        status: "finished",
        score: { home: 2, away: 1 },
      }),
      "Final",
      "No Rating App vote",
    ],
  ])("renders the %s state", (_case, value, stateText, detailText) => {
    renderCard({ match: value, hasResults: false });
    expect(screen.getByText(stateText)).toBeInTheDocument();
    expect(screen.getByText(detailText)).toBeInTheDocument();
  });

  it("links an open window to the existing ballot and closed results to the existing results route", () => {
    const ready = match({
      id: "ready",
      status: "finished",
      ratingState: "rating_ready",
      votingOpensAt: "2026-08-31T11:00:00.000Z",
      votingClosesAt: "2026-08-31T13:00:00.000Z",
      score: { home: 2, away: 0 },
    });
    const { rerender } = renderCard({ match: ready, hasResults: false });
    expect(screen.getByRole("link", { name: "Rate match" })).toHaveAttribute(
      "href",
      "/matches/ready/rate",
    );

    rerender(
      card({
        match: { ...ready, id: "closed", ratingState: "rating_closed" },
        hasResults: true,
      }),
    );
    expect(screen.getByRole("link", { name: "View results" })).toHaveAttribute(
      "href",
      "/matches/closed/results",
    );
  });

  it("renders confirmed tracked-team and opponent goals chronologically with stoppage time", () => {
    const value = match({
      goalEvents: [
        {
          externalTeamId: "815",
          externalPlayerId: "1",
          scorerName: "Allan Cruz",
          elapsed: 23,
          kind: "normal",
        },
        {
          externalTeamId: "820",
          externalPlayerId: "2",
          scorerName: "Opponent Player",
          elapsed: 45,
          extra: 2,
          kind: "penalty",
        },
      ],
    });
    render(<GoalSummary match={value} messages={messages} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Allan Cruz");
    expect(items[0]).toHaveTextContent("23'");
    expect(items[0]).toHaveTextContent("Herediano goal");
    expect(items[1]).toHaveTextContent("Opponent Player");
    expect(items[1]).toHaveTextContent("45+2'");
    expect(items[1]).toHaveTextContent("Opponent goal");
    expect(formatGoalMinute(value.goalEvents![1])).toBe("45+2'");
  });

  it("does not guess goal attribution for a legacy match without the tracked provider ID", () => {
    const value = match({
      trackedTeamExternalProviderId: undefined,
      goalEvents: [
        {
          externalTeamId: "815",
          externalPlayerId: "1",
          scorerName: "Allan Cruz",
          elapsed: 23,
          kind: "normal",
        },
      ],
    });

    render(<GoalSummary match={value} messages={messages} />);

    expect(screen.getByRole("listitem")).toHaveTextContent("Goal");
    expect(screen.getByRole("listitem")).not.toHaveTextContent(
      "Herediano goal",
    );
  });
});

function renderCard(item: MatchArchiveItem) {
  return render(card(item));
}

function card(item: MatchArchiveItem) {
  return <MatchCard item={item} locale="en" messages={messages} now={now} />;
}

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: "match",
    trackedTeamId: "team",
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "CS Herediano" },
    awayTeam: { externalProviderId: "820", name: "CS Cartaginés" },
    kickoffAt: "2026-09-01T18:00:00.000Z",
    status: "scheduled",
    ratingState: "not_ready",
    score: { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: "1",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}
