import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchArchiveItem } from "@/application/match-archive";
import type { Match } from "@/domain/models";
import { getMessages } from "@/i18n/messages";
import { getBallotStatus } from "@/lib/firebase/ballot-client";

import { MatchArchiveView, MatchCard } from "./match-archive";
import { MatchDetail } from "./match-detail";
import { formatGoalMinute, GoalSummary } from "./goal-summary";

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
      screen.queryByText("Your rating has already been recorded."),
    ).not.toBeInTheDocument();
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

  it("keeps a submitted secondary status compact and non-actionable", async () => {
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

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Rating submitted",
    );
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

  it("keeps the featured match above accessible tabs and switches compact archive panels", async () => {
    const user = userEvent.setup();
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

    const featuredHeading = screen.getByRole("heading", {
      name: "Featured match",
    });
    const tablist = screen.getByRole("tablist");
    expect(
      featuredHeading.compareDocumentPosition(tablist) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const upcomingTab = screen.getByRole("tab", { name: "Upcoming matches" });
    const recentTab = screen.getByRole("tab", { name: "Recent matches" });
    expect(upcomingTab).toHaveAttribute("aria-selected", "true");
    expect(upcomingTab).toHaveAttribute("aria-controls", "upcoming-panel");
    expect(recentTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "upcoming-tab",
    );
    expect(screen.getByText("Upcoming opponent")).toBeInTheDocument();
    expect(screen.getByText(/Sep 6/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("tabpanel")).getByText("VS"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Next match").length).toBeGreaterThan(0);
    expect(screen.queryByText("Recent opponent")).not.toBeInTheDocument();
    expect(screen.getAllByText("Featured opponent")).toHaveLength(1);

    await user.click(recentTab);
    expect(recentTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "recent-tab",
    );
    expect(screen.getByText("Recent opponent")).toBeInTheDocument();
    expect(screen.getByText("2 - 1")).toBeInTheDocument();
    expect(screen.getByText("Final")).toBeInTheDocument();
    expect(screen.queryByText("No Rating App vote")).not.toBeInTheDocument();
    expect(screen.getAllByText("Featured opponent")).toHaveLength(1);

    await user.click(upcomingTab);
    expect(screen.getByText("Upcoming opponent")).toBeInTheDocument();
    expect(screen.queryByText("Recent opponent")).not.toBeInTheDocument();
    expect(screen.getAllByText("Featured opponent")).toHaveLength(1);
  });

  it("supports arrow, Home, and End tab keyboard navigation", async () => {
    const user = userEvent.setup();
    render(
      <MatchArchiveView
        archive={{ relevant: null, upcoming: [], recent: [] }}
        locale="en"
        messages={messages}
        ballotMessages={ballotMessages}
        now={now}
      />,
    );
    const upcomingTab = screen.getByRole("tab", { name: "Upcoming matches" });
    const recentTab = screen.getByRole("tab", { name: "Recent matches" });

    upcomingTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(recentTab).toHaveFocus();
    expect(recentTab).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(upcomingTab).toHaveFocus();
    await user.keyboard("{End}");
    expect(recentTab).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(upcomingTab).toHaveFocus();
  });

  it("shows the localized empty state independently for each tab", async () => {
    const user = userEvent.setup();
    render(
      <MatchArchiveView
        archive={{ relevant: null, upcoming: [], recent: [] }}
        locale="en"
        messages={messages}
        ballotMessages={ballotMessages}
        now={now}
      />,
    );

    expect(screen.getByText(messages.noUpcoming)).toBeInTheDocument();
    expect(screen.queryByText(messages.noRecent)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: messages.recent }));
    expect(screen.getByText(messages.noRecent)).toBeInTheDocument();
    expect(screen.queryByText(messages.noUpcoming)).not.toBeInTheDocument();
  });

  it("keeps archive DTOs sanitized to match presentation facts", () => {
    const archiveItem = item(match());
    const serialized = JSON.stringify(archiveItem);

    expect(serialized).not.toContain("voterId");
    expect(serialized).not.toContain("ballot");
    expect(Object.keys(archiveItem)).toEqual(["match", "hasResults"]);
  });

  it("attributes multiple finished goals to the exact home and away Teams", () => {
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
        {
          externalTeamId: "815",
          externalPlayerId: "3",
          scorerName: "Second home scorer",
          elapsed: 72,
          kind: "normal",
        },
      ],
    });
    render(<GoalSummary match={value} messages={messages} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("CS Herediano · Allan Cruz23'");
    expect(items[0]).toHaveAttribute("data-goal-side", "home");
    expect(items[0]).toHaveAccessibleName(
      "Goal by CS Herediano, Allan Cruz, 23'",
    );
    expect(items[1]).toHaveTextContent("CS Cartaginés · Opponent Player45+2'");
    expect(items[1]).toHaveAttribute("data-goal-side", "away");
    expect(items[1]).toHaveAccessibleName(
      "Goal by CS Cartaginés, Opponent Player, 45+2'",
    );
    expect(items[2]).toHaveTextContent("CS Herediano · Second home scorer72'");
    expect(formatGoalMinute(value.goalEvents![1])).toBe("45+2'");
  });

  it("fails closed for unknown finished-goal Teams and handles missing or long scorer data", () => {
    const longTeamName =
      "A very long away Team name that must remain readable on mobile";
    const longScorerName =
      "A deliberately long scorer name that must wrap without overflow";
    const value = match({
      awayTeam: { externalProviderId: "820", name: longTeamName },
      goalEvents: [
        {
          externalTeamId: "815",
          externalPlayerId: "1",
          scorerName: "",
          elapsed: 23,
          kind: "normal",
        },
        {
          externalTeamId: "820",
          externalPlayerId: "2",
          scorerName: longScorerName,
          elapsed: 45,
          extra: 4,
          kind: "normal",
        },
        {
          externalTeamId: "unknown",
          externalPlayerId: "3",
          scorerName: "Unknown Team scorer",
          elapsed: 60,
          kind: "normal",
        },
        {
          externalTeamId: undefined as never,
          externalPlayerId: "4",
          scorerName: "Missing Team scorer",
          elapsed: 70,
          kind: "normal",
        },
      ],
    });

    render(<GoalSummary match={value} messages={messages} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("CS Herediano23'");
    expect(items[0]).toHaveAccessibleName("Goal by CS Herediano, 23'");
    expect(items[1]).toHaveTextContent(
      `${longTeamName} · ${longScorerName}45+4'`,
    );
    expect(items[1]).toHaveAccessibleName(
      `Goal by ${longTeamName}, ${longScorerName}, 45+4'`,
    );
    expect(items[1].querySelector(".min-w-0.flex-1")).toHaveClass(
      "break-words",
    );
    expect(screen.queryByText("Unknown Team scorer")).not.toBeInTheDocument();
    expect(screen.queryByText("Missing Team scorer")).not.toBeInTheDocument();
  });

  it("reuses the compact persisted-goal summary for a live match detail", () => {
    const value = match({
      status: "live",
      score: { home: 1, away: 0 },
      goalEvents: [
        {
          externalTeamId: "815",
          externalPlayerId: "1",
          scorerName: "Live scorer",
          elapsed: 45,
          extra: 2,
          kind: "normal",
        },
      ],
    });

    render(
      <MatchDetail
        item={item(value)}
        locale="en"
        messages={messages}
        ballotMessages={ballotMessages}
        now={now}
      />,
    );

    expect(screen.getByText("1 - 0")).toBeInTheDocument();
    const goalItem = within(
      screen.getByRole("region", { name: "Confirmed goals" }),
    ).getByRole("listitem");
    expect(goalItem).toHaveTextContent("Live scorer·45+2'");
    expect(goalItem).toHaveAttribute("data-goal-side", "home");
    expect(goalItem).toHaveAccessibleName(
      "Goal by CS Herediano, Live scorer, 45+2'",
    );
  });

  it.each([
    ["scheduled", { status: "scheduled", ratingState: "not_ready" }],
    ["preparing", { status: "finished", ratingState: "preparing_rating" }],
  ] as const)(
    "does not render a live goal summary for %s detail",
    (_name, state) => {
      render(
        <MatchDetail
          item={item(match(state))}
          locale="en"
          messages={messages}
          ballotMessages={ballotMessages}
          now={now}
        />,
      );

      expect(
        screen.queryByRole("region", { name: "Confirmed goals" }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps the finished score, results action, and standalone goal card", () => {
    render(
      <MatchDetail
        item={item(
          match({
            status: "finished",
            ratingState: "rating_closed",
            score: { home: 2, away: 1 },
            goalEvents: [
              {
                externalTeamId: "815",
                externalPlayerId: "1",
                scorerName: "Finished scorer",
                elapsed: 70,
                kind: "normal",
              },
            ],
          }),
          true,
        )}
        locale="en"
        messages={messages}
        ballotMessages={ballotMessages}
        now={now}
      />,
    );

    expect(screen.getByRole("region", { name: "Confirmed goals" })).toHaveClass(
      "card",
    );
    expect(screen.getByText("2 - 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View results" })).toHaveAttribute(
      "href",
      "/matches/match/results",
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "CS Herediano · Finished scorer70'",
    );
    expect(screen.getByRole("listitem")).toHaveAccessibleName(
      "Goal by CS Herediano, Finished scorer, 70'",
    );
  });

  it("uses stable team identity for side placement and a safe scorer fallback", () => {
    const longName =
      "A deliberately long opponent scorer name that must wrap inside one half";
    const value = match({
      status: "live",
      goalEvents: [
        {
          externalTeamId: "820",
          externalPlayerId: "1",
          scorerName: "CS Herediano",
          elapsed: 12,
          kind: "normal",
        },
        {
          externalTeamId: "815",
          externalPlayerId: "",
          scorerName: "",
          elapsed: 20,
          kind: "other",
        },
        {
          externalTeamId: "820",
          externalPlayerId: "2",
          scorerName: longName,
          elapsed: 30,
          kind: "normal",
        },
        {
          externalTeamId: "unknown",
          externalPlayerId: "3",
          scorerName: "Unknown side",
          elapsed: 40,
          kind: "normal",
        },
      ],
    });

    render(<GoalSummary match={value} messages={messages} compact />);

    const goals = screen.getAllByRole("listitem");
    expect(goals).toHaveLength(3);
    expect(goals[0]).toHaveAttribute("data-goal-side", "away");
    expect(goals[0]).toHaveTextContent("12'·CS Herediano");
    expect(goals[1]).toHaveAttribute("data-goal-side", "home");
    expect(goals[1]).toHaveTextContent("CS Herediano·20'");
    expect(goals[1]).toHaveAccessibleName("Goal by CS Herediano, 20'");
    expect(goals[2]).toHaveAttribute("data-goal-side", "away");
    expect(screen.queryByText("Unknown side")).not.toBeInTheDocument();
    expect(screen.getByText(longName)).toHaveClass("min-w-0", "break-words");
    expect(screen.getByText(longName).parentElement).toHaveAttribute(
      "data-goal-half",
      "away",
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

function item(value: Match, hasResults = false): MatchArchiveItem {
  return { match: value, hasResults };
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
