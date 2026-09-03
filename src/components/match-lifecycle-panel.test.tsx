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
      />,
    );

    expect(
      screen.queryByRole("link", { name: "Compartir votación por WhatsApp" }),
    ).not.toBeInTheDocument();
  });
});

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
