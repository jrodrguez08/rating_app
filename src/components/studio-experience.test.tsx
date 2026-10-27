import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioMatchPresentation } from "@/application/studio";
import { getMessages } from "@/i18n/messages";

import { StudioExperience } from "./studio-experience";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

describe("StudioExperience", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers one responsive, keyboard-operable flow for all three views", async () => {
    const user = userEvent.setup();
    renderStudio();

    expect(
      screen.getByRole("heading", { name: "Rating App Studio" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Jugador canónico")).toBeInTheDocument();
    const podiumTab = screen.getByRole("tab", { name: "Podio" });
    podiumTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("tab", { name: "Ranking completo" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("list")).toHaveClass("sm:grid-cols-2");
    await user.keyboard("{End}");
    expect(screen.getByText("Promedio de jugadores")).toBeInTheDocument();
    expect(screen.getByText("8,0")).toBeInTheDocument();
    expect(
      screen.getByText(/no incluye al director técnico/i),
    ).toBeInTheDocument();
  });

  it("switches published matches and invokes fullscreen directly from the control", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.selectOptions(
      screen.getByLabelText("Partido publicado"),
      "match-2",
    );
    expect(navigation.push).toHaveBeenCalledWith("/studio?match=match-2");

    await user.click(
      screen.getByRole("button", { name: "Presentar en pantalla completa" }),
    );
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledOnce();
  });

  it("keeps the stable OBS URL selectable and reports copy failures accessibly", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    renderStudio();
    const input = screen.getByLabelText("URL de la fuente para OBS");
    expect(input).toHaveValue("https://rating-app.test/studio/overlay/match-1");
    await user.click(screen.getByRole("button", { name: "Copiar URL de OBS" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "No pudimos copiar la URL",
    );
  });

  it("provides a deterministic browser-fullscreen fallback", async () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    renderStudio();
    expect(
      await screen.findByText(/pantalla completa no está disponible/i),
    ).toBeInTheDocument();
  });
});

function renderStudio() {
  return render(
    <StudioExperience
      presentation={presentation}
      matches={[
        option("match-1", "2026-10-20T02:00:00.000Z"),
        option("match-2", "2026-10-10T02:00:00.000Z"),
      ]}
      overlayUrl="https://rating-app.test/studio/overlay/match-1"
      locale="es"
      messages={getMessages("es").studio}
    />,
  );
}

function option(matchId: string, kickoffAt: string) {
  return {
    matchId,
    kickoffAt,
    homeTeamName: "Herediano",
    awayTeamName: "Pérez Zeledón",
    score: { home: 2, away: 1 },
  };
}

const presentation: StudioMatchPresentation = {
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
      player("canonical", "Jugador canónico", 9, 1, true),
      player("second", "Segundo", 8, 2),
      player("third", "Tercero", 7, 3),
    ],
    topThree: [
      player("canonical", "Jugador canónico", 9, 1, true),
      player("second", "Segundo", 8, 2),
      player("third", "Tercero", 7, 3),
    ],
  },
  playerAverage: 8,
  highestRatedPlayer: player("canonical", "Jugador canónico", 9, 1, true),
  lowestRatedPlayer: player("third", "Tercero", 7, 3),
};

function player(
  playerId: string,
  displayName: string,
  average: number,
  rank: number,
  isMvp = false,
) {
  return { playerId, displayName, average, voteCount: 4, rank, isMvp };
}
