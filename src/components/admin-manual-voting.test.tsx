import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";

import { AdminManualVotingPanel } from "./admin-manual-voting";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const messages = getMessages("es").admin;
afterEach(() => vi.unstubAllGlobals());

describe("manual voting admin panel", () => {
  it("blocks opening until the verified lineup and coach are ready", () => {
    const value = detail();
    value.match.confirmedStarterCount = 10;
    value.match.verification = undefined;
    value.manualVotingAvailability = { state: "invalid_starter_count" };
    renderPanel(value);

    expect(
      screen.getAllByText(
        messages.manualVotingStates.invalid_starter_count.description,
      )[0],
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: messages.openVotingNow }),
    ).not.toBeInTheDocument();
  });

  it.each([
    "missing_verified_lineup",
    "missing_verified_coach",
    "reconciliation_conflict",
  ] as const)("explains the exact %s blocker", (state) => {
    const value = detail();
    value.manualVotingAvailability = { state };
    renderPanel(value);

    expect(screen.getByRole("status")).toHaveTextContent(
      messages.manualVotingStates[state].description,
    );
    expect(
      screen.queryByRole("button", { name: messages.openVotingNow }),
    ).not.toBeInTheDocument();
  });

  it.each(["postponed", "suspended", "cancelled", "abandoned"] as const)(
    "explains why %s cannot open voting",
    (status) => {
      const value = detail();
      value.match.status = status;
      value.manualVotingAvailability = { state: "ineligible_status" };
      renderPanel(value);
      expect(
        screen.getByText(messages.manualVotingStatusBlocked[status]),
      ).toBeVisible();
    },
  );

  it("uses one explicit confirmation and no evidence, ID, or exact-string fields", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ previewToken: "preview", plan: {} }))
      .mockResolvedValueOnce(response({ authorized: true }))
      .mockResolvedValueOnce(response({ applied: true, auditId: "audit" }));
    vi.stubGlobal("fetch", fetchMock);
    renderPanel(detail());

    expect(
      screen.queryByLabelText(messages.finalWhistleEvidence),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(messages.confirmation),
    ).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(messages.finalWhistleAttestation));
    await user.type(
      screen.getByLabelText(messages.passphrase),
      "owner passphrase",
    );
    await user.click(
      screen.getByRole("button", { name: messages.openVotingNow }),
    );

    expect(await screen.findByText(messages.manualVotingOpened)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const applyBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(applyBody.confirmation).toBe("open-voting:match-manual");
  });

  it("defaults to a two-hour window and offers an exact Costa Rica close", async () => {
    const user = userEvent.setup();
    renderPanel(detail());
    expect(screen.getByLabelText(messages.defaultVotingClose)).toBeChecked();
    await user.click(screen.getByLabelText(messages.customVotingClose));
    expect(screen.getByLabelText(messages.costaRicaCloseTime)).toBeVisible();
  });

  it("shows the authoritative open window summary without another opening form", () => {
    const value = detail();
    value.match.ratingState = "rating_ready";
    value.match.votingPresentation = "open";
    value.match.effectiveVotingOpensAt = "2026-10-19T20:00:00.000Z";
    value.match.effectiveVotingClosesAt = "2026-10-19T22:00:00.000Z";
    value.match.votingRemainingMinutes = 73;
    value.match.assignment = {
      coachId: "coach-1",
      coachName: "Jafet Soto",
      provenance: "operator_verified",
    };
    value.manualVotingAvailability = { state: "voting_open" };
    renderPanel(value);

    expect(
      screen.getByRole("heading", {
        name: messages.manualVotingStates.voting_open.title,
      }),
    ).toBeVisible();
    expect(screen.getByText(/Jafet Soto/)).toBeVisible();
    expect(screen.getByText(/73 min/)).toBeVisible();
    expect(screen.getAllByText(/Costa Rica/)).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: messages.openVotingNow }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["voting_expired", "expired"],
    ["results_published", "published"],
    ["invalid_window", "invalid"],
  ] as const)(
    "renders %s as a read-only lifecycle state",
    (state, presentation) => {
      const value = detail();
      value.match.ratingState =
        state === "results_published" ? "rating_closed" : "rating_ready";
      value.match.votingPresentation = presentation;
      value.manualVotingAvailability = { state };
      renderPanel(value);

      expect(
        screen.getByRole("heading", {
          name: messages.manualVotingStates[state].title,
        }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: messages.openVotingNow }),
      ).not.toBeInTheDocument();
      if (state === "results_published") {
        expect(
          screen.getByRole("link", { name: messages.viewResults }),
        ).toHaveAttribute("href", "/matches/match-manual/results");
      }
    },
  );
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
      votingPresentation: "preparation",
      participantCount: 21,
      rateableParticipantCount: 16,
      confirmedStarterCount: 11,
      confirmedSubstituteCount: 5,
      unconfirmedOrUnusedCount: 5,
      headCoachReady: false,
      lineupProvenance: "operator_verified",
      verification: {
        coachId: "coach-1",
        verificationSource: "authenticated-owner",
        verificationReason: "Confirmado por propietario",
        verifiedAt: "2026-10-20T01:00:00.000Z",
      },
    },
    participants: [],
    players: [],
    manualVotingAvailability: { state: "available" },
  };
}

function response(body: unknown) {
  return { ok: true, json: async () => body };
}
