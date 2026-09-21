import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import { VoteComparisonSection } from "./vote-comparison";

vi.mock("@/lib/firebase/voter-auth", () => ({
  getVoterIdToken: vi.fn().mockResolvedValue("token"),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("vote comparison UI", () => {
  it("renders an accessible shared header and compact rows in result order", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ready",
          comparison: {
            players: [
              {
                id: "a",
                name: "Long Player Name That Wraps",
                userRating: 8,
                communityAverage: 7.3,
                difference: 0.7,
              },
              {
                id: "b",
                name: "Second",
                userRating: 6,
                communityAverage: 7.1,
                difference: -1.1,
              },
              {
                id: "c",
                name: "Third",
                userRating: 7,
                communityAverage: 7,
                difference: 0,
              },
            ],
            coach: {
              id: "coach",
              name: "Coach",
              userRating: 8,
              communityAverage: 7.5,
              difference: 0.5,
            },
          },
        }),
      ),
    );
    render(
      <VoteComparisonSection
        matchId="match-1"
        locale="en"
        messages={getMessages("en").results.comparison}
      />,
    );
    expect(
      await screen.findByText("Long Player Name That Wraps"),
    ).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("w-full", "table-fixed");
    expect(
      within(table).getByRole("columnheader", { name: "Player" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Your vote" }),
    ).toHaveTextContent("You");
    expect(
      within(table).getByRole("columnheader", { name: "Fans" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", {
        name: "Difference from the average",
      }),
    ).toHaveTextContent("Δ");
    expect(
      screen.getByText("Δ = your vote − community average"),
    ).toBeInTheDocument();

    const playerRows = ["Long Player Name That Wraps", "Second", "Third"].map(
      (name) => within(table).getByRole("rowheader", { name }).closest("tr"),
    );
    expect(playerRows.every(Boolean)).toBe(true);
    expect(playerRows[0]?.compareDocumentPosition(playerRows[1]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(playerRows[1]?.compareDocumentPosition(playerRows[2]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      within(playerRows[0]!).getByRole("cell", {
        name: "+0.7 above the average",
      }),
    ).toBeInTheDocument();
    expect(
      within(playerRows[1]!).getByRole("cell", {
        name: "-1.1 below the average",
      }),
    ).toBeInTheDocument();
    expect(
      within(playerRows[2]!).getByRole("cell", {
        name: "0.0 equal to the average",
      }),
    ).toBeInTheDocument();
    expect(playerRows[0]).toHaveTextContent("8.0");
    expect(playerRows[0]).toHaveTextContent("7.3");
    expect(
      within(table).getByRole("rowheader", {
        name: "Long Player Name That Wraps",
      }),
    ).toHaveClass("[overflow-wrap:anywhere]");
    expect(table.querySelector(".game-inset")).toBeNull();
    const coachRow = within(table)
      .getByRole("rowheader", { name: "Coach" })
      .closest("tr");
    expect(coachRow).toHaveTextContent("8.0");
    expect(coachRow).toHaveTextContent("7.5");
    expect(coachRow).toHaveTextContent("+0.5");
    expect(within(table).getByText("Head coach")).toBeInTheDocument();
  });

  it("shows a neutral state when the current voter did not submit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "no_ballot" })),
    );
    render(
      <VoteComparisonSection
        matchId="match-1"
        locale="es"
        messages={getMessages("es").results.comparison}
      />,
    );
    expect(
      await screen.findByText("No enviaste un voto para este partido."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("uses full Spanish labels and keeps loading and unavailable messages", async () => {
    let finish: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <VoteComparisonSection
        matchId="match-1"
        locale="es"
        messages={getMessages("es").results.comparison}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cargando tu comparación...",
    );
    await waitFor(() => expect(finish).toBeDefined());
    finish?.(
      new Response(JSON.stringify({ status: "unavailable" }), { status: 503 }),
    );
    expect(
      await screen.findByText("No pudimos mostrar tu comparación ahora."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders concise Spanish columns with full accessible names", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ready",
          comparison: {
            players: [
              {
                id: "a",
                name: "Jugador",
                userRating: 8,
                communityAverage: 7.3,
                difference: 0.7,
              },
            ],
            coach: {
              id: "c",
              name: "Entrenador",
              userRating: 7,
              communityAverage: 7,
              difference: 0,
            },
          },
        }),
      ),
    );
    render(
      <VoteComparisonSection
        matchId="match-1"
        locale="es"
        messages={getMessages("es").results.comparison}
      />,
    );
    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Tu voto" }),
    ).toHaveTextContent("Tú");
    expect(
      within(table).getByRole("columnheader", { name: "Afición" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", {
        name: "Diferencia respecto a la media",
      }),
    ).toHaveTextContent("Δ");
    expect(
      within(table).getByRole("cell", { name: "+0,7 por encima de la media" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", { name: "0,0 igual a la media" }),
    ).toBeInTheDocument();
  });
});
