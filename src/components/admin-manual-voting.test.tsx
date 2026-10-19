import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";

import { AdminManualVotingPanel } from "./admin-manual-voting";

const messages = getMessages("es").admin;

describe("manual voting admin panel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("blocks preview until the authoritative lineup and coach are ready", () => {
    renderPanel({
      ...detail(),
      match: {
        ...detail().match,
        confirmedStarterCount: 10,
        verification: undefined,
      },
    });

    expect(
      screen.getByText(messages.manualVotingMissingEvidence),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: messages.preview }),
    ).not.toBeInTheDocument();
  });

  it("previews, authorizes, and applies only after exact confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          previewToken: "preview-token",
          plan: {
            providerStatus: "live",
            verificationSource: "https://example.com/final",
            proposedOpensAt: "2026-10-20T02:00:00.000Z",
            proposedClosesAt: "2026-10-20T04:00:00.000Z",
            durationMinutes: 120,
            verifiedStarterCount: 11,
            confirmedSubstituteCount: 1,
            excludedSubstituteCount: 2,
            verifiedCoachId: "coach-1",
          },
        }),
      )
      .mockResolvedValueOnce(response({ authorized: true }))
      .mockResolvedValueOnce(
        response({ applied: true, auditId: "manual-voting-audit" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderPanel(detail());

    await user.type(
      screen.getByLabelText(messages.finalWhistleEvidence),
      "https://example.com/final",
    );
    await user.type(
      screen.getByLabelText(messages.reason),
      "Acta revisada del partido",
    );
    await user.click(screen.getByLabelText(messages.finalWhistleAttestation));
    await user.click(screen.getByRole("button", { name: messages.preview }));
    expect(await screen.findByText(messages.manualVotingPreview)).toBeVisible();

    await user.type(
      screen.getByLabelText(messages.passphrase),
      "owner passphrase",
    );
    await user.click(screen.getByRole("button", { name: messages.authorize }));
    const apply = await screen.findByRole("button", {
      name: messages.openVotingNow,
    });
    expect(apply).toBeDisabled();
    await user.type(
      screen.getByLabelText(messages.confirmation),
      "open-voting:match-manual",
    );
    expect(apply).toBeEnabled();
    await user.click(apply);

    expect(await screen.findByText(/manual-voting-audit/)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function renderPanel(value: AdminMatchDetail) {
  return render(
    <AdminManualVotingPanel
      detail={value}
      messages={messages}
      teamId="team-manual"
    />,
  );
}

function detail(): AdminMatchDetail {
  return {
    match: {
      id: "match-manual",
      externalFixtureId: "fixture-manual",
      kickoffAt: "2026-10-20T00:00:00.000Z",
      homeTeamName: "Local",
      awayTeamName: "Visitante",
      status: "live",
      ratingState: "preparing_rating",
      participantCount: 14,
      rateableParticipantCount: 12,
      confirmedStarterCount: 11,
      confirmedSubstituteCount: 1,
      unconfirmedOrUnusedCount: 2,
      headCoachReady: true,
      lineupProvenance: "operator_verified",
      assignment: {
        coachId: "coach-1",
        coachName: "Director",
        provenance: "operator_verified",
      },
      verification: {
        coachId: "coach-1",
        verificationSource: "https://example.com/coach",
        verificationReason: "Acta revisada",
        verifiedAt: "2026-10-20T01:00:00.000Z",
      },
    },
    participants: [],
    players: [],
  };
}

function response(body: unknown) {
  return { ok: true, json: async () => body };
}
