import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";
import { getBallotStatus } from "@/lib/firebase/ballot-client";

import { BallotEntry } from "./ballot-entry";

vi.mock("@/lib/firebase/ballot-client", () => ({
  getBallotStatus: vi.fn(),
}));

const shareHref = "https://wa.me/?text=rating";

describe("BallotEntry submitted state", () => {
  beforeEach(() => {
    vi.mocked(getBallotStatus).mockResolvedValue("submitted");
  });

  it.each([
    ["es" as const, "Calificación enviada", "Compartir votación por WhatsApp"],
    ["en" as const, "Rating submitted", "Share voting via WhatsApp"],
  ])(
    "renders a localized non-interactive status beside WhatsApp in %s",
    async (locale, submittedLabel, shareLabel) => {
      render(
        <BallotEntry
          matchId="match-1"
          messages={getMessages(locale).home.matchLifecycle.ready}
          shareHref={shareHref}
        />,
      );

      const status = await screen.findByRole("status");
      const share = screen.getByRole("link", { name: shareLabel });

      expect(status).toHaveTextContent(submittedLabel);
      expect(status).not.toHaveAttribute("tabindex");
      expect(status.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(
        screen.queryByRole("button", { name: submittedLabel }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: submittedLabel }),
      ).not.toBeInTheDocument();
      expect(share).toHaveAttribute("href", shareHref);
      expect(share).toHaveAttribute("aria-label", shareLabel);
      expect(share).toHaveAttribute("title", shareLabel);
      expect(status.parentElement?.parentElement).toHaveClass(
        "max-w-full",
        "flex-wrap",
      );
      expect(status).toHaveClass("max-w-full");
      expect(share).toHaveClass("shrink-0");
    },
  );

  it("keeps the normal rating action for a voter who has not submitted", async () => {
    vi.mocked(getBallotStatus).mockResolvedValue("available");
    render(
      <BallotEntry
        matchId="match-1"
        messages={getMessages("es").home.matchLifecycle.ready}
        shareHref={shareHref}
      />,
    );

    expect(
      await screen.findByRole("link", { name: "Calificar partido" }),
    ).toHaveAttribute("href", "/matches/match-1/rate");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
