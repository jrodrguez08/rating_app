import { render, screen, within } from "@testing-library/react";
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
  it("renders localized signed one-decimal values and labels in compact wrapping rows", async () => {
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
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("+0.7")).toBeInTheDocument();
    expect(within(rows[1]).getByText("-1.1")).toBeInTheDocument();
    expect(within(rows[2]).getByText("0.0")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("Your vote 8.0");
    expect(rows[0]).toHaveTextContent("Fans 7.3");
    expect(rows[0]).toHaveTextContent("above the average");
    expect(rows[0].className).toContain("min-w-0");
    expect(
      screen.getByRole("heading", { name: "Head coach" }),
    ).toBeInTheDocument();
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
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
