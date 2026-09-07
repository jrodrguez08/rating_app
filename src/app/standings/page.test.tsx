import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/firebase/server", () => ({
  AdminStandingsService: class {
    get = mocks.get;
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import StandingsPage from "./page";

describe("StandingsPage", () => {
  it("renders only the persisted server snapshot without a provider dependency", async () => {
    mocks.get.mockResolvedValue({
      trackedTeamExternalProviderId: "815",
      snapshot: {
        id: "club-sport-herediano",
        trackedTeamId: "club-sport-herediano",
        competitionId: "competition-162",
        competitionName: "Primera Divisi\u00f3n",
        seasonId: "season-2026",
        seasonName: "2026",
        externalProvider: "api-football",
        externalProviderCompetitionId: "162",
        externalProviderSeason: 2026,
        rows: [
          {
            rank: 1,
            externalTeamId: "815",
            teamName: "CS Herediano",
            played: 1,
            won: 1,
            drawn: 0,
            lost: 0,
            goalsFor: 2,
            goalsAgainst: 0,
            goalDifference: 2,
            points: 3,
          },
        ],
        providerSyncedAt: "2026-09-07T09:00:00.000Z",
        createdAt: "2026-09-07T09:00:00.000Z",
        updatedAt: "2026-09-07T09:00:00.000Z",
      },
    });
    render(await StandingsPage());
    expect(
      screen.getByRole("heading", { name: "Tabla de posiciones" }),
    ).toBeInTheDocument();
    expect(screen.getByText("CS Herediano")).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledOnce();
  });

  it("fails safely when no snapshot exists", async () => {
    mocks.get.mockResolvedValue(null);
    render(await StandingsPage());
    expect(
      screen.getByText(/no est\u00e1 disponible temporalmente/i),
    ).toBeInTheDocument();
  });
});
