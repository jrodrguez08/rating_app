import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getMessages } from "@/i18n/messages";

import { AdminLifecycleActionPanel } from "./admin-lifecycle-action";

const messages = getMessages("es").admin;

describe("admin lifecycle readiness", () => {
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
});
