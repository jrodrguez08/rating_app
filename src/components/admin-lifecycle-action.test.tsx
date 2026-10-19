import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import { AdminLifecycleActionPanel } from "./admin-lifecycle-action";

const messages = getMessages("es").admin;

describe("admin lifecycle readiness", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows readiness evidence, measured delay, and the bounded owner action", () => {
    render(
      <AdminLifecycleActionPanel
        teamId="tracked-team"
        messages={messages}
        match={{
          id: "match-ready-check",
          externalFixtureId: "fixture-ready-check",
          kickoffAt: "2026-10-18T18:00:00.000Z",
          homeTeamName: "Local",
          awayTeamName: "Visitante",
          status: "finished",
          ratingState: "preparing_rating",
          votingPresentation: "preparation",
          finishedObservedAt: "2026-10-18T20:00:00.000Z",
          participantSyncedAt: "2026-10-18T20:03:00.000Z",
          ratingReadyAt: "2026-10-18T20:04:00.000Z",
          votingOpensAt: "2026-10-18T20:04:00.000Z",
          participantCount: 14,
          rateableParticipantCount: 12,
          confirmedStarterCount: 11,
          confirmedSubstituteCount: 1,
          unconfirmedOrUnusedCount: 2,
          headCoachReady: true,
          lineupProvenance: "operator_verified",
        }}
      />,
    );

    expect(screen.getByText(messages.confirmedStarters)).toBeVisible();
    expect(screen.getByText("11/11")).toBeVisible();
    expect(
      screen.getByText(messages.provenance.operator_verified),
    ).toBeVisible();
    expect(screen.getByText("4 min")).toBeVisible();
    expect(
      screen.getByRole("button", { name: messages.requestLifecycle }),
    ).toBeEnabled();
  });

  it.each([
    ["scheduled", "not_ready", messages.lifecycleUnavailableScheduled],
    ["finished", "rating_ready", messages.lifecycleUnavailableVoting],
    ["finished", "rating_closed", messages.lifecycleUnavailableFinalized],
    ["postponed", "not_ready", messages.lifecycleUnavailableState],
  ] as const)(
    "keeps the lifecycle action visible and disabled for %s/%s",
    (status, ratingState, explanation) => {
      render(
        <AdminLifecycleActionPanel
          teamId="tracked-team"
          messages={messages}
          match={{
            id: `match-${status}-${ratingState}`,
            externalFixtureId: "fixture-ineligible",
            kickoffAt: "2026-10-18T18:00:00.000Z",
            homeTeamName: "Local",
            awayTeamName: "Visitante",
            status,
            ratingState,
            votingPresentation:
              ratingState === "rating_ready"
                ? "open"
                : ratingState === "rating_closed"
                  ? "published"
                  : "preparation",
            participantCount: 0,
            rateableParticipantCount: 0,
            confirmedStarterCount: 0,
            confirmedSubstituteCount: 0,
            unconfirmedOrUnusedCount: 0,
            headCoachReady: false,
            lineupProvenance: "unavailable",
          }}
        />,
      );

      expect(
        screen.getByRole("button", { name: messages.requestLifecycle }),
      ).toBeDisabled();
      expect(screen.getByText(explanation)).toBeVisible();
    },
  );

  it.each(["live", "finished"] as const)(
    "enables the lifecycle action for an eligible %s match",
    (status) => {
      render(
        <AdminLifecycleActionPanel
          teamId="tracked-team"
          messages={messages}
          match={{
            id: `match-${status}`,
            externalFixtureId: "fixture-eligible",
            kickoffAt: "2026-10-18T18:00:00.000Z",
            homeTeamName: "Local",
            awayTeamName: "Visitante",
            status,
            ratingState: "preparing_rating",
            votingPresentation: "preparation",
            participantCount: 11,
            rateableParticipantCount: 11,
            confirmedStarterCount: 11,
            confirmedSubstituteCount: 0,
            unconfirmedOrUnusedCount: 0,
            headCoachReady: true,
            lineupProvenance: "provider",
          }}
        />,
      );

      expect(
        screen.getByRole("button", { name: messages.requestLifecycle }),
      ).toBeEnabled();
    },
  );

  it("clears the passphrase and reveals confirmation after delayed authorization", async () => {
    const user = userEvent.setup();
    let resolveAuthorization:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const path = String(input);
      if (path.endsWith("/preview")) {
        return Promise.resolve(
          response({
            plan: { matchId: "match-live" },
            previewToken: "preview",
          }),
        );
      }
      if (path.endsWith("/authorize")) {
        return new Promise((resolve) => {
          resolveAuthorization = resolve;
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEligiblePanel();

    await user.click(
      screen.getByRole("button", { name: messages.requestLifecycle }),
    );
    const passphrase = await screen.findByLabelText(messages.passphrase);
    await user.type(passphrase, "independent-secret");
    const authorize = screen.getByRole("button", { name: messages.authorize });
    await user.click(authorize);
    await user.click(authorize);

    expect(authorize).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/authorize"),
      ),
    ).toHaveLength(1);
    resolveAuthorization?.(response({ authorized: true }));

    expect(
      await screen.findByText(messages.authorizationSuccess),
    ).toBeVisible();
    expect(passphrase).toHaveValue("");
    expect(screen.getByLabelText(messages.confirmation)).toBeVisible();
  });

  it("reports rejected authorization and restores submission without confirmation", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        String(input).endsWith("/preview")
          ? Promise.resolve(response({ plan: {}, previewToken: "preview" }))
          : Promise.resolve({
              ok: false,
              json: async () => ({ error: "La autorización fue rechazada." }),
            }),
      ),
    );
    renderEligiblePanel();

    await user.click(
      screen.getByRole("button", { name: messages.requestLifecycle }),
    );
    const passphrase = await screen.findByLabelText(messages.passphrase);
    await user.type(passphrase, "wrong-secret");
    await user.click(screen.getByRole("button", { name: messages.authorize }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La autorización fue rechazada.",
    );
    expect(passphrase).toHaveValue("wrong-secret");
    expect(
      screen.getByRole("button", { name: messages.authorize }),
    ).toBeEnabled();
    expect(
      screen.queryByLabelText(messages.confirmation),
    ).not.toBeInTheDocument();
  });
});

function renderEligiblePanel() {
  return render(
    <AdminLifecycleActionPanel
      teamId="tracked-team"
      messages={messages}
      match={{
        id: "match-live",
        externalFixtureId: "fixture-live",
        kickoffAt: "2026-10-18T18:00:00.000Z",
        homeTeamName: "Local",
        awayTeamName: "Visitante",
        status: "live",
        ratingState: "preparing_rating",
        votingPresentation: "preparation",
        participantCount: 11,
        rateableParticipantCount: 11,
        confirmedStarterCount: 11,
        confirmedSubstituteCount: 0,
        unconfirmedOrUnusedCount: 0,
        headCoachReady: true,
        lineupProvenance: "provider",
      }}
    />,
  );
}

function response(body: unknown) {
  return { ok: true, json: async () => body };
}
