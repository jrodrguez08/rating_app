import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";
import type { AdminMatchOperation } from "@/lib/firebase/admin-console";

import { AdminProviderCheck } from "./admin-provider-check";

const messages = getMessages("es").admin;

describe("admin post-match provider check", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a simple comparison without exposing technical identities", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        report: {
          status: "differences",
          checkedAt: "2026-10-21T12:00:00.000Z",
          providerRequests: 4,
          persisted: true,
          retainedEarlierEvidence: false,
          localEvidenceSource: "operator_verified",
          local: {
            starters: [{ name: "Aarón Salazar" }],
            participatingSubstitutes: [
              { name: "D. González", enteredAtMinute: 61 },
            ],
            coachName: "Jafet Soto",
          },
          provider: {
            starters: [{ name: "A. Salazar" }],
            participatingSubstitutes: [],
            coachName: "J. Soto",
          },
          differences: [
            { type: "participation_mismatch", name: "D. González" },
          ],
          missingEvidence: ["substitute_participation"],
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    document.cookie = `rating_admin_csrf=${"c".repeat(43)}`;
    renderPanel(finalizedMatch());

    await userEvent.click(
      screen.getByRole("button", { name: messages.providerCheck.action }),
    );

    expect(
      await screen.findByText(messages.providerCheck.statuses.differences),
    ).toBeVisible();
    expect(screen.getByText("Aarón Salazar")).toBeVisible();
    expect(screen.getAllByText(/D\. González/)).toHaveLength(2);
    expect(screen.getByText("Jafet Soto")).toBeVisible();
    expect(screen.getByText("J. Soto")).toBeVisible();
    expect(
      screen.getByText(messages.providerCheck.missing.substitute_participation),
    ).toBeVisible();
    expect(
      screen.queryByText(/1551706|player-|coach-/),
    ).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/provider-check",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Admin-CSRF": "c".repeat(43),
        }),
      }),
    );
  });

  it("keeps the action visible but disabled before finalization", () => {
    renderPanel({
      ...finalizedMatch(),
      ratingState: "rating_ready",
      votingPresentation: "open",
    });

    expect(
      screen.getByRole("button", { name: messages.providerCheck.action }),
    ).toBeDisabled();
    expect(screen.getByText(messages.providerCheck.unavailable)).toBeVisible();
  });

  it("renders a persisted comparison immediately after navigation or reload", () => {
    render(
      <AdminProviderCheck
        match={finalizedMatch()}
        messages={messages}
        teamId="club-sport-herediano"
        initialReport={{
          status: "partial",
          checkedAt: "2026-10-21T12:00:00.000Z",
          evidenceObservedAt: "2026-10-21T11:59:00.000Z",
          providerRequests: 4,
          persisted: true,
          retainedEarlierEvidence: false,
          localEvidenceSource: "operator_verified",
          local: {
            starters: [{ name: "D. Gonz\u00e1lez" }],
            participatingSubstitutes: [],
            coachName: "Jafet Soto",
          },
          provider: {
            starters: [{ name: "Daniel Gonz\u00e1lez" }],
            participatingSubstitutes: [],
          },
          differences: [],
          missingEvidence: ["coach"],
        }}
      />,
    );

    expect(screen.getByText("Daniel Gonz\u00e1lez")).toBeVisible();
    expect(screen.getByText(messages.providerCheck.noCoach)).toBeVisible();
    expect(
      screen.getByText(messages.providerCheck.evidenceSavedAt),
    ).toBeVisible();
  });
});

function renderPanel(match: AdminMatchOperation) {
  return render(
    <AdminProviderCheck
      match={match}
      messages={messages}
      teamId="club-sport-herediano"
    />,
  );
}

function finalizedMatch(): AdminMatchOperation {
  return {
    id: "match-10a50b08075ca1f0646e5b6d",
    externalFixtureId: "1551706",
    kickoffAt: "2026-10-18T23:00:00.000Z",
    homeTeamName: "Herediano",
    awayTeamName: "Pérez Zeledón",
    status: "finished",
    ratingState: "rating_closed",
    votingPresentation: "published",
    participantCount: 21,
    rateableParticipantCount: 16,
    confirmedStarterCount: 11,
    confirmedSubstituteCount: 5,
    unconfirmedOrUnusedCount: 5,
    headCoachReady: true,
    lineupProvenance: "operator_verified",
  };
}

function json(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}
