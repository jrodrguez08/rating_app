import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublishedResultPageState } from "@/lib/firebase/server";

const services = vi.hoisted(() => ({
  listPublishedMatches: vi.fn(),
  getPublishedPageState: vi.fn(),
}));

vi.mock("@/lib/firebase/server", () => ({
  AdminStudioService: class {
    listPublishedMatches = services.listPublishedMatches;
  },
  AdminResultService: class {
    getPublishedPageState = services.getPublishedPageState;
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import StudioOverlayPage from "./overlay/[matchId]/page";
import StudioPage from "./page";

describe("public Studio routes", () => {
  beforeEach(() => {
    services.listPublishedMatches.mockReset();
    services.getPublishedPageState.mockReset();
    services.listPublishedMatches.mockResolvedValue([option]);
    services.getPublishedPageState.mockResolvedValue(readyPage);
  });

  it("renders published Studio data without an owner or voter session", async () => {
    render(await StudioPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { name: "Rating App Studio" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Jugador canónico")).toBeInTheDocument();
    expect(
      (screen.getByLabelText("URL de la fuente para OBS") as HTMLInputElement)
        .value,
    ).toContain("/studio/overlay/match-1");
    expect(services.getPublishedPageState).toHaveBeenCalledWith("match-1");
  });

  it("does not expose an unpublished result in the overlay", async () => {
    services.getPublishedPageState.mockResolvedValue({ state: "locked" });
    render(
      await StudioOverlayPage({
        params: Promise.resolve({ matchId: "match-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByText("Resultados publicados no disponibles"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Jugador canónico")).not.toBeInTheDocument();
  });
});

const option = {
  matchId: "match-1",
  kickoffAt: "2026-10-20T02:00:00.000Z",
  homeTeamName: "Herediano",
  awayTeamName: "Pérez Zeledón",
  score: { home: 2, away: 1 },
};

const readyPage = {
  state: "ready",
  match: {
    id: "match-1",
    trackedTeamId: "club-sport-herediano",
    competitionId: "competition-1",
    seasonId: "season-1",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "819", name: "Pérez Zeledón" },
    kickoffAt: "2026-10-20T02:00:00.000Z",
    status: "finished",
    ratingState: "rating_closed",
    score: { home: 2, away: 1 },
    externalProvider: "api-football",
    externalProviderFixtureId: "1551706",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-20T05:00:00.000Z",
  },
  result: {
    matchId: "match-1",
    teamId: "club-sport-herediano",
    ballotCount: 4,
    status: "final",
    playerResults: {},
    coachResult: {
      coachId: "coach-1",
      coachName: "Jafet Soto",
      average: 7.5,
      voteCount: 4,
    },
    mvpPlayerIds: ["canonical"],
    generatedAt: "2026-10-20T05:00:00.000Z",
  },
  podium: {
    matchId: "match-1",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "819", name: "Pérez Zeledón" },
    score: { home: 2, away: 1 },
    publishedMatchDate: "2026-10-20T02:00:00.000Z",
    generatedAt: "2026-10-20T05:00:00.000Z",
    players: [
      {
        playerId: "canonical",
        displayName: "Jugador canónico",
        average: 9,
        voteCount: 4,
        rank: 1,
        isMvp: true,
      },
    ],
    topThree: [
      {
        playerId: "canonical",
        displayName: "Jugador canónico",
        average: 9,
        voteCount: 4,
        rank: 1,
        isMvp: true,
      },
    ],
  },
} satisfies PublishedResultPageState;
