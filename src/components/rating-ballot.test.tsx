import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BallotContext } from "@/domain/models";
import { enMessages } from "@/i18n/messages/en";
import { esMessages } from "@/i18n/messages/es";
import { getBallotStatus, submitBallot } from "@/lib/firebase/ballot-client";

import { BallotRouteState } from "./ballot-route-state";
import { RatingBallot } from "./rating-ballot";

vi.mock("@/lib/firebase/ballot-client", () => ({
  getBallotStatus: vi.fn(),
  submitBallot: vi.fn(),
}));

const context: BallotContext = {
  matchId: "match-1",
  teamId: "club-sport-herediano",
  homeTeamName: "Herediano",
  awayTeamName: "Cartagin\u00e9s",
  score: { home: 2, away: 1 },
  votingClosesAt: "2026-08-29T22:00:00.000Z",
  players: [
    {
      id: "starter",
      name: "Jugador Titular",
      position: "M",
      substitute: false,
    },
    { id: "used-sub", name: "Suplente Usado", substitute: true },
  ],
  coach: { id: "coach-1", name: "Director T\u00e9cnico" },
};

beforeEach(() => {
  vi.mocked(getBallotStatus).mockReset().mockResolvedValue("available");
  vi.mocked(submitBallot).mockReset().mockResolvedValue("created");
});

describe("RatingBallot", () => {
  it("renders only supplied eligible participants and localized substitute context", async () => {
    render(
      <RatingBallot
        context={context}
        locale="es"
        messages={esMessages.ballot}
      />,
    );
    expect(await screen.findByText("Jugador Titular")).toBeInTheDocument();
    expect(screen.getByText("Suplente Usado")).toBeInTheDocument();
    expect(screen.getByText("SUP")).toBeInTheDocument();
    expect(screen.queryByText("Opponent Player")).not.toBeInTheDocument();
    expect(screen.queryByText("Unused Substitute")).not.toBeInTheDocument();
    expect(screen.getByText("Director T\u00e9cnico")).toBeInTheDocument();
  });

  it("tracks completion, confirms, and transitions to submitted", async () => {
    const user = userEvent.setup();
    render(
      <RatingBallot
        context={context}
        locale="en"
        messages={enMessages.ballot}
      />,
    );
    await screen.findByText("0 / 3 rated");
    const submit = screen.getByRole("button", { name: "Submit rating" });
    expect(submit).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Rating for Jugador Titular: 8" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Rating for Suplente Usado: 7" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Rating for Director T\u00e9cnico: 9",
      }),
    );
    expect(screen.getByText("3 / 3 rated")).toBeInTheDocument();
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(
      screen.getByRole("alertdialog", { name: "Confirm rating" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Confirm and submit" }),
    );
    await waitFor(() => expect(submitBallot).toHaveBeenCalledOnce());
    expect(
      await screen.findByText("Your votes were recorded."),
    ).toBeInTheDocument();
    expect(submitBallot).toHaveBeenCalledWith("match-1", {
      playerRatings: { starter: 8, "used-sub": 7 },
      coachRating: { coachId: "coach-1", rating: 9 },
    });
  });

  it("shows an existing submission without editable controls", async () => {
    vi.mocked(getBallotStatus).mockResolvedValue("submitted");
    render(
      <RatingBallot
        context={context}
        locale="en"
        messages={enMessages.ballot}
      />,
    );
    expect(
      await screen.findByText("Your votes were recorded."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit rating" })).toBeNull();
  });

  it("keeps ratings after a recoverable submission failure", async () => {
    vi.mocked(submitBallot).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(
      <RatingBallot
        context={context}
        locale="en"
        messages={enMessages.ballot}
      />,
    );
    await screen.findByText("0 / 3 rated");
    for (const [name, rating] of [
      ["Jugador Titular", 8],
      ["Suplente Usado", 7],
      ["Director T\u00e9cnico", 9],
    ] as const) {
      await user.click(
        screen.getByRole("button", { name: `Rating for ${name}: ${rating}` }),
      );
    }
    await user.click(screen.getByRole("button", { name: "Submit rating" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm and submit" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't submit your rating",
    );
    expect(
      screen.getByRole("button", { name: "Rating for Jugador Titular: 8" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("traps confirmation focus and restores it when cancelled", async () => {
    const user = userEvent.setup();
    render(
      <RatingBallot
        context={context}
        locale="en"
        messages={enMessages.ballot}
      />,
    );
    await screen.findByText("0 / 3 rated");
    for (const name of [
      "Jugador Titular",
      "Suplente Usado",
      "Director T\u00e9cnico",
    ]) {
      await user.click(
        screen.getByRole("button", { name: `Rating for ${name}: 8` }),
      );
    }
    const submit = screen.getByRole("button", { name: "Submit rating" });
    await user.click(submit);
    const heading = screen.getByRole("heading", { name: "Confirm rating" });
    await waitFor(() => expect(heading).toHaveFocus());

    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Review ratings" }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Confirm and submit" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(submit).toHaveFocus());
  });
});

describe("BallotRouteState", () => {
  it("shows closed state or submitted state without exposing results", async () => {
    const { rerender } = render(
      <BallotRouteState
        matchId="match-1"
        state="closed"
        messages={enMessages.ballot}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Voting has ended" }),
    ).toBeVisible();
    expect(screen.queryByText(/average/i)).toBeNull();

    vi.mocked(getBallotStatus).mockResolvedValue("submitted");
    rerender(
      <BallotRouteState
        matchId="match-2"
        state="closed"
        messages={enMessages.ballot}
      />,
    );
    expect(await screen.findByText("Your votes were recorded.")).toBeVisible();
  });
});
