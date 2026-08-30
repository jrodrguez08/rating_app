import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { HomeContent } from "./page";

const upcomingMatch = {
  id: "match-1",
  trackedTeamId: "club-sport-herediano",
  competitionId: "competition-1",
  seasonId: "season-1",
  homeTeam: {
    externalProviderId: "cartagines-provider-id",
    name: "CS Cartagin\u00e9s",
  },
  awayTeam: { externalProviderId: "815", name: "CS Herediano" },
  kickoffAt: "2026-08-30T23:00:00.000Z",
  status: "scheduled" as const,
  ratingState: "not_ready" as const,
  score: { home: null, away: null },
  externalProvider: "api-football",
  externalProviderFixtureId: "5001",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("Home", () => {
  it("renders the current product UI in default Spanish", () => {
    render(<HomeContent locale="es" />);
    expect(
      screen.getByRole("heading", { name: "Club Sport Herediano" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Heredia por Media Calle")).toBeInTheDocument();
    expect(
      screen.queryByText("Comunidad inicial de aficionados"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "No hay una calificación activa",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/los resultados permanecen ocultos/i),
    ).toBeInTheDocument();
  });

  it("renders the same product UI in English", () => {
    render(<HomeContent locale="en" />);
    expect(screen.getByText("Heredia por Media Calle")).toBeInTheDocument();
    expect(
      screen.queryByText("Initial supporter community"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No active rating" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/results stay hidden while voting is open/i),
    ).toBeInTheDocument();
  });

  it("renders a localized safe persistence failure instead of an empty state", () => {
    render(<HomeContent locale="en" unavailable />);
    expect(
      screen.getByRole("heading", { name: "We couldn't load the match" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No active rating")).not.toBeInTheDocument();
  });

  it("makes the real upcoming matchup primary without a repeated heading", () => {
    render(<HomeContent locale="es" match={upcomingMatch} />);
    expect(
      screen.getByRole("heading", { name: "Pr\u00f3ximo partido" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Pr\u00f3ximo partido")).toHaveLength(1);
    expect(screen.getByText("CS Cartagin\u00e9s")).toBeInTheDocument();
    expect(screen.getByText("CS Herediano")).toBeInTheDocument();
    expect(screen.getByText("VS")).toBeInTheDocument();
    expect(screen.getAllByTestId("team-badge")).toHaveLength(2);
  });

  it("keeps the upcoming state localized in English", () => {
    render(<HomeContent locale="en" match={upcomingMatch} />);
    expect(
      screen.getByRole("heading", { name: "Next match" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Next match")).toHaveLength(1);
    expect(screen.getByText("CS Cartagin\u00e9s")).toBeInTheDocument();
    expect(screen.getByText("CS Herediano")).toBeInTheDocument();
  });

  it("communicates live, preparing, ready, and results states with text", () => {
    const states = [
      {
        status: "live" as const,
        ratingState: "not_ready" as const,
        title: "Match in progress",
      },
      {
        status: "finished" as const,
        ratingState: "preparing_rating" as const,
        title: "Preparing the rating",
      },
      {
        status: "finished" as const,
        ratingState: "rating_ready" as const,
        title: "The match is ready to rate",
      },
      {
        status: "finished" as const,
        ratingState: "rating_closed" as const,
        title: "Community results",
      },
    ];
    for (const state of states) {
      const { unmount } = render(
        <HomeContent locale="en" match={{ ...upcomingMatch, ...state }} />,
      );
      expect(
        screen.getByRole("heading", { name: state.title }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("exposes semantic primary navigation with future destinations disabled", () => {
    render(<HomeContent locale="es" />);
    const navigation = screen.getByRole("navigation", {
      name: "Navegación principal",
    });
    const homeLink = within(navigation).getByRole("link", { name: "Inicio" });
    expect(homeLink).toHaveAttribute("href", "/");
    expect(homeLink).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByText("Partidos")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(navigation).getByText("Jugadores")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("provides a keyboard skip link and a labeled main region", () => {
    render(<HomeContent locale="es" />);
    expect(
      screen.getByRole("link", { name: "Ir al contenido" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });
});
