import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Match } from "@/domain/models";
import { getMessages } from "@/i18n/messages";
import { getBallotStatus } from "@/lib/firebase/ballot-client";

import { MatchLifecyclePanel } from "./match-lifecycle-panel";

vi.mock("@/lib/firebase/ballot-client", () => ({
  getBallotStatus: vi.fn(),
}));

const messages = getMessages("es").home.matchLifecycle;
const now = Date.now();

describe("Home WhatsApp rating share", () => {
  beforeEach(() => {
    vi.mocked(getBallotStatus).mockResolvedValue("available");
  });

  it("keeps Calificar primary and shows a secondary accessible share action during the open window", async () => {
    render(
      <MatchLifecyclePanel
        match={match({
          ratingState: "rating_ready",
          status: "finished",
          votingOpensAt: new Date(now - 60_000).toISOString(),
          votingClosesAt: new Date(now + 60_000).toISOString(),
        })}
        locale="es"
        messages={messages}
        goalMessages={getMessages("es").matches}
      />,
    );

    const rate = await screen.findByRole("link", { name: "Calificar partido" });
    const share = screen.getByRole("link", {
      name: "Compartir votación por WhatsApp",
    });

    expect(rate).toHaveAttribute("href", "/matches/public-match/rate");
    expect(rate).toHaveClass("button-primary");
    expect(share).toHaveClass("button-secondary");
    expect(share).toHaveAttribute("target", "_blank");
    expect(share).toHaveAttribute("rel", "noopener noreferrer");
    expect(share.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(
      new URL(share.getAttribute("href")!).searchParams.get("text"),
    ).toContain(
      "https://rating-app-amber.vercel.app/matches/public-match/rate",
    );
  });

  it("keeps WhatsApp actionable beside a submitted non-interactive status", async () => {
    vi.mocked(getBallotStatus).mockResolvedValue("submitted");
    render(
      <MatchLifecyclePanel
        match={match({
          ratingState: "rating_ready",
          status: "finished",
          votingOpensAt: new Date(now - 60_000).toISOString(),
          votingClosesAt: new Date(now + 60_000).toISOString(),
        })}
        locale="es"
        messages={messages}
        goalMessages={getMessages("es").matches}
      />,
    );

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Calificación enviada");
    expect(
      screen.getByRole("link", { name: "Compartir votación por WhatsApp" }),
    ).toHaveAttribute("title", "Compartir votación por WhatsApp");
    expect(
      screen.queryByRole("link", { name: "Calificar partido" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      "expired",
      {
        ratingState: "rating_ready",
        status: "finished",
        votingOpensAt: new Date(now - 120_000).toISOString(),
        votingClosesAt: new Date(now - 60_000).toISOString(),
      },
    ],
    [
      "not yet open",
      {
        ratingState: "rating_ready",
        status: "finished",
        votingOpensAt: new Date(now + 60_000).toISOString(),
        votingClosesAt: new Date(now + 120_000).toISOString(),
      },
    ],
    ["preparing", { ratingState: "preparing_rating", status: "finished" }],
    ["scheduled", { ratingState: "not_ready", status: "scheduled" }],
    ["live", { ratingState: "not_ready", status: "live" }],
    ["closed", { ratingState: "rating_closed", status: "finished" }],
    ["cancelled", { ratingState: "not_ready", status: "cancelled" }],
    ["postponed", { ratingState: "not_ready", status: "postponed" }],
    ["suspended", { ratingState: "not_ready", status: "suspended" }],
    ["historical", { ratingState: "not_ready", status: "finished" }],
  ] as const)("does not expose sharing for %s matches", (_name, state) => {
    render(
      <MatchLifecyclePanel
        match={match(state)}
        locale="es"
        messages={messages}
        goalMessages={getMessages("es").matches}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "Compartir votación por WhatsApp" }),
    ).not.toBeInTheDocument();
  });

  it("renders persisted live goals chronologically without changing the score", () => {
    render(
      <MatchLifecyclePanel
        match={match({
          status: "live",
          score: { home: 2, away: 1 },
          goalEvents: [
            goal({ scorerName: "Late scorer", elapsed: 54 }),
            goal({
              externalTeamId: "820",
              scorerName: "First scorer",
              elapsed: 18,
            }),
            goal({
              externalTeamId: "820",
              scorerName: "Second at 54",
              elapsed: 54,
            }),
          ],
        })}
        locale="es"
        messages={messages}
        goalMessages={getMessages("es").matches}
      />,
    );

    expect(screen.getByText("2 - 1")).toBeInTheDocument();
    const goals = screen.getAllByRole("listitem");
    expect(goals[0]).toHaveTextContent("18'·First scorer");
    expect(goals[1]).toHaveTextContent("Late scorer·54'");
    expect(goals[2]).toHaveTextContent("54'·Second at 54");
    expect(goals[0]).toHaveAttribute("data-goal-side", "away");
    expect(goals[1]).toHaveAttribute("data-goal-side", "home");
    expect(goals[2]).toHaveAttribute("data-goal-side", "away");
    expect(goals[1].querySelector('[data-goal-half="home"]')).toHaveClass(
      "justify-end",
      "text-right",
    );
    expect(goals[0].querySelector('[data-goal-half="away"]')).toHaveClass(
      "justify-start",
      "text-left",
    );
    expect(goals[0]).toHaveAccessibleName(
      "Gol de CS Cartaginés, First scorer, 18'",
    );
  });

  it("renders no empty goal section for a scoreless live match", () => {
    render(
      <MatchLifecyclePanel
        match={match({ status: "live", score: { home: 0, away: 0 } })}
        locale="es"
        messages={messages}
        goalMessages={getMessages("es").matches}
      />,
    );

    expect(screen.getByText("0 - 0")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Goles confirmados" }),
    ).not.toBeInTheDocument();
  });
});

function goal(overrides: Partial<NonNullable<Match["goalEvents"]>[number]>) {
  return {
    externalTeamId: "815",
    externalPlayerId: "player",
    scorerName: "Scorer",
    elapsed: 10,
    kind: "normal" as const,
    ...overrides,
  };
}

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: "public-match",
    trackedTeamId: "club-sport-herediano",
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
    externalProviderFixtureId: "provider-fixture",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}
