import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchArchiveItem } from "@/application/match-archive";
import type { Match } from "@/domain/models";
import { getMessages } from "@/i18n/messages";
import { getBallotStatus } from "@/lib/firebase/ballot-client";

import {
  formatGoalMinute,
  GoalSummary,
  MatchArchiveView,
  MatchCard,
} from "./match-archive";
import { MatchDetail } from "./match-detail";

vi.mock("@/lib/firebase/ballot-client", () => ({
  getBallotStatus: vi.fn(),
}));

const allMessages = getMessages("en");
const messages = allMessages.matches;
const ballotMessages = allMessages.home.matchLifecycle.ready;
const now = new Date("2026-08-31T12:00:00.000Z");

describe("Partidos presentation", () => {
  beforeEach(() => {
    vi.mocked(getBallotStatus).mockResolvedValue("available");
  });

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

  it("offers the existing ballot flow when voting is open and the voter has not submitted", async () => {
    const ready = match({
      id: "ready",
      status: "finished",
      ratingState: "rating_ready",
      votingOpensAt: "2026-08-31T11:00:00.000Z",
      votingClosesAt: "2026-08-31T13:00:00.000Z",
      score: { home: 2, away: 0 },
    });
    renderCard({ match: ready, hasResults: false });

    expect(
      await screen.findByRole("link", { name: "Rate match" }),
    ).toHaveAttribute("href", "/matches/ready/rate");
  });

  it("shows the submitted state without another rating action on cards and match detail", async () => {
    vi.mocked(getBallotStatus).mockResolvedValue("submitted");
    const ready = match({
      id: "ready",
      status: "finished",
      ratingState: "rating_ready",
      votingOpensAt: "2026-08-31T11:00:00.000Z",
      votingClosesAt: "2026-08-31T13:00:00.000Z",
      score: { home: 2, away: 0 },
    });
    const item = { match: ready, hasResults: false };
    const { unmount } = renderCard(item);

    expect(await screen.findByText("Rating submitted")).toBeInTheDocument();
    expect(
      screen.getByText("Your rating has already been recorded."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Rate match" }),
    ).not.toBeInTheDocument();

    unmount();
    render(
      <MatchDetail
        item={item}
        locale="en"
        messages={messages}
        ballotMessages={ballotMessages}
        now={now}
      />,
    );

    expect(await screen.findByText("Rating submitted")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Rate match" }),
    ).not.toBeInTheDocument();
  });

  it("fails closed without a rating action when ballot status is unavailable", async () => {
    vi.mocked(getBallotStatus).mockResolvedValue("data_unavailable");
    const ready = match({
      status: "finished",
      ratingState: "rating_ready",
      votingOpensAt: "2026-08-31T11:00:00.000Z",
      votingClosesAt: "2026-08-31T13:00:00.000Z",
    });

    renderCard({ match: ready, hasResults: false });

    expect(
      await screen.findByText("We couldn't prepare your session. Try again."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Rate match" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a submitted secondary card compact and non-actionable", async () => {
    vi.mocked(getBallotStatus).mockResolvedValue("submitted");
    const ready = item(
      match({
        id: "secondary-ready",
        status: "finished",
        ratingState: "rating_ready",
        votingOpensAt: "2026-08-31T11:00:00.000Z",
        votingClosesAt: "2026-08-31T13:00:00.000Z",
      }),
    );

    render(
      <MatchArchiveView
        archive={{ relevant: null, upcoming: [ready], recent: [] }}
        locale="en"
        messages={messages}
        ballotMessages={ballotMessages}
        now={now}
      />,
    );

    expect(await screen.findByText("Rating submitted")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Rate match" }),
    ).not.toBeInTheDocument();
  });

  it("links closed results to the existing results route", () => {
    const ready = match({
      id: "closed",
      status: "finished",
      ratingState: "rating_closed",
      score: { home: 2, away: 0 },
    });

    renderCard({ match: ready, hasResults: true });
    expect(screen.getByRole("link", { name: "View results" })).toHaveAttribute(
      "href",
      "/matches/closed/results",
    );
  });

  it("places compact upcoming matches before recent matches without dominant no-vote copy", () => {
    const featured = item(
      match({
        id: "featured",
        awayTeam: { externalProviderId: "1", name: "Featured opponent" },
      }),
    );
    const upcoming = item(
      match({
        id: "upcoming",
        kickoffAt: "2026-09-06T23:00:00.000Z",
        awayTeam: { externalProviderId: "2", name: "Upcoming opponent" },
      }),
    );
    const recent = item(
      match({
        id: "recent",
        status: "finished",
        kickoffAt: "2026-08-30T23:00:00.000Z",
        score: { home: 2, away: 1 },
        awayTeam: { externalProviderId: "3", name: "Recent opponent" },
      }),
    );

    render(
      <MatchArchiveView
        archive={{ relevant: featured, upcoming: [upcoming], recent: [recent] }}
        locale="en"
        messages={messages}
        ballotMessages={ballotMessages}
        now={now}
      />,
    );

    const upcomingHeading = screen.getByRole("heading", {
      name: "Upcoming matches",
    });
    const recentHeading = screen.getByRole("heading", {
      name: "Recent matches",
    });
    expect(
      upcomingHeading.compareDocumentPosition(recentHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Upcoming opponent")).toBeInTheDocument();
    expect(screen.getByText(/Sep 6/)).toBeInTheDocument();
    expect(screen.getByText("Recent opponent")).toBeInTheDocument();
    expect(screen.getByText("2 - 1")).toBeInTheDocument();
    expect(screen.getAllByText("Next match").length).toBeGreaterThan(0);
    expect(screen.getByText("Final")).toBeInTheDocument();
    expect(screen.queryByText("No Rating App vote")).not.toBeInTheDocument();
    expect(screen.getAllByText("Featured opponent")).toHaveLength(1);
  });

  it("keeps archive DTOs sanitized to match presentation facts", () => {
    const archiveItem = item(match());
    const serialized = JSON.stringify(archiveItem);

    expect(serialized).not.toContain("voterId");
    expect(serialized).not.toContain("ballot");
    expect(Object.keys(archiveItem)).toEqual(["match", "hasResults"]);
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
  return (
    <MatchCard
      item={item}
      locale="en"
      messages={messages}
      ballotMessages={ballotMessages}
      now={now}
    />
  );
}

function item(value: Match): MatchArchiveItem {
  return { match: value, hasResults: false };
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
