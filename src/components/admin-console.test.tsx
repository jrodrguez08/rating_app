import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";
import type { AdminMatchOperation } from "@/lib/firebase/admin-console";

import { AdminConsole, AdminLogin } from "./admin-console";

const mocks = vi.hoisted(() => ({
  getAdminBrowserAuth: vi.fn(),
  refresh: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/firebase/admin-browser", () => ({
  getAdminBrowserAuth: mocks.getAdminBrowserAuth,
}));

vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: mocks.signIn,
  signOut: mocks.signOut,
}));

const messages = getMessages("es").admin;

describe("admin console", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mocks.getAdminBrowserAuth.mockResolvedValue({ name: "admin-auth" });
    mocks.signOut.mockResolvedValue(undefined);
  });

  it("renders an accessible Spanish login without registration", () => {
    render(<AdminLogin messages={messages} />);
    expect(
      screen.getByRole("textbox", { name: messages.email }),
    ).toBeRequired();
    expect(screen.getByLabelText(messages.password)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByRole("button", { name: messages.signIn })).toBeEnabled();
    expect(screen.queryByText(/registr/i)).not.toBeInTheDocument();
  });

  it("shows the full login operation as busy and prevents duplicate submission", async () => {
    const user = userEvent.setup();
    mocks.signIn.mockReturnValue(new Promise(() => undefined));
    render(<AdminLogin messages={messages} />);

    await user.type(screen.getByLabelText(messages.email), "owner@example.com");
    await user.type(screen.getByLabelText(messages.password), "secret-value");
    const button = screen.getByRole("button", { name: messages.signIn });
    await user.click(button);
    await user.click(button);

    expect(
      screen.getByRole("button", { name: messages.signingIn }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      messages.signingInStatus,
    );
    expect(screen.getByLabelText(messages.email)).toHaveValue(
      "owner@example.com",
    );
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it("restores the login form with the generic error after failure", async () => {
    const user = userEvent.setup();
    mocks.signIn.mockRejectedValue(new Error("provider detail"));
    render(<AdminLogin messages={messages} />);

    await user.type(screen.getByLabelText(messages.email), "owner@example.com");
    await user.type(screen.getByLabelText(messages.password), "wrong-value");
    await user.click(screen.getByRole("button", { name: messages.signIn }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.credentialsError,
    );
    expect(screen.getByRole("button", { name: messages.signIn })).toBeEnabled();
    expect(screen.getByLabelText(messages.email)).toHaveValue(
      "owner@example.com",
    );
  });

  it("creates the server session and refreshes the console after success", async () => {
    const user = userEvent.setup();
    const getIdToken = vi.fn().mockResolvedValue("verified-id-token");
    mocks.signIn.mockResolvedValue({ user: { getIdToken } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<AdminLogin messages={messages} />);

    await user.type(screen.getByLabelText(messages.email), "owner@example.com");
    await user.type(screen.getByLabelText(messages.password), "secret-value");
    await user.click(screen.getByRole("button", { name: messages.signIn }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit coach selection and shows persisted diagnostics", () => {
    render(
      <AdminConsole
        messages={messages}
        teamId="club-sport-herediano"
        overview={{
          upcomingLiveMatches: [],
          attentionMatches: [
            {
              id: "match-1",
              externalFixtureId: "fixture-1",
              kickoffAt: "2026-10-18T20:00:00.000Z",
              homeTeamName: "Equipo local",
              awayTeamName: "Equipo visitante",
              status: "finished",
              ratingState: "preparing_rating",
              votingPresentation: "preparation",
              diagnostic: "ambiguous_coach",
              participantCount: 22,
              rateableParticipantCount: 11,
              confirmedStarterCount: 11,
              confirmedSubstituteCount: 0,
              unconfirmedOrUnusedCount: 11,
              headCoachReady: false,
              lineupProvenance: "unavailable",
            },
          ],
          votingCompletedMatches: [],
          coaches: [
            {
              id: "coach-1",
              name: "Director verificado",
              provenance: "operator_verified",
            },
          ],
        }}
      />,
    );
    expect(
      screen.getAllByText(/Identidad del director ambigua/),
    ).not.toHaveLength(0);
    expect(screen.getByLabelText(messages.manualCoachId)).toHaveValue("");
    expect(
      screen.getByRole("button", { name: messages.preview }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: messages.signOut }),
    ).toBeEnabled();
  });

  it("prioritizes open, expired, and published states over stale diagnostics", () => {
    render(
      <AdminConsole
        messages={messages}
        teamId="club-sport-herediano"
        overview={{
          upcomingLiveMatches: [],
          attentionMatches: [],
          votingCompletedMatches: [
            operation("open", "rating_ready", "voting-open"),
            operation("expired", "rating_ready", "voting-expired"),
            operation("published", "rating_closed", "voting-published"),
          ],
          coaches: [],
        }}
      />,
    );

    expect(screen.getByText(messages.votingPresentation.open)).toBeVisible();
    expect(screen.getByText(messages.votingPresentation.expired)).toBeVisible();
    expect(
      screen.getByText(messages.votingPresentation.published),
    ).toBeVisible();
    expect(
      screen.queryByText(messages.diagnostics.unknown),
    ).not.toBeInTheDocument();
  });

  it("shows a safe actionable message for an unrecognized current diagnostic", () => {
    const current = operation("preparation", "preparing_rating", "current");
    current.diagnostic = undefined;
    current.unrecognizedDiagnostic = true;
    render(
      <AdminConsole
        messages={messages}
        teamId="club-sport-herediano"
        overview={{
          upcomingLiveMatches: [],
          attentionMatches: [current],
          votingCompletedMatches: [],
          coaches: [],
        }}
      />,
    );

    expect(screen.getByText(messages.unrecognizedDiagnostic)).toBeVisible();
    expect(
      screen.queryByText(messages.diagnostics.unknown),
    ).not.toBeInTheDocument();
  });

  it("clears the coach passphrase and prevents duplicate authorization", async () => {
    const user = userEvent.setup();
    let resolveAuthorization:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const path = String(input);
      if (path.endsWith("/preview")) {
        return Promise.resolve(
          response({ plan: { coachId: "coach-1" }, previewToken: "preview" }),
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
    render(
      <AdminConsole
        messages={messages}
        teamId="club-sport-herediano"
        overview={{
          upcomingLiveMatches: [],
          attentionMatches: [
            {
              id: "match-1",
              externalFixtureId: "fixture-1",
              kickoffAt: "2026-10-18T20:00:00.000Z",
              homeTeamName: "Equipo local",
              awayTeamName: "Equipo visitante",
              status: "finished",
              ratingState: "preparing_rating",
              votingPresentation: "preparation",
              diagnostic: "ambiguous_coach",
              participantCount: 11,
              rateableParticipantCount: 11,
              confirmedStarterCount: 11,
              confirmedSubstituteCount: 0,
              unconfirmedOrUnusedCount: 0,
              headCoachReady: false,
              lineupProvenance: "provider",
            },
          ],
          votingCompletedMatches: [],
          coaches: [
            {
              id: "coach-1",
              name: "Director verificado",
              provenance: "operator_verified",
            },
          ],
        }}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText(messages.existingCoach),
      "coach-1",
    );
    await user.type(
      screen.getByLabelText(messages.evidence),
      "https://evidence.example.test/coach",
    );
    await user.type(
      screen.getByLabelText(messages.reason),
      "Evidencia independiente revisada para este partido.",
    );
    await user.click(screen.getByRole("button", { name: messages.preview }));
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
});

function response(body: unknown) {
  return { ok: true, json: async () => body };
}

function operation(
  votingPresentation: AdminMatchOperation["votingPresentation"],
  ratingState: AdminMatchOperation["ratingState"],
  id: string,
): AdminMatchOperation {
  return {
    id,
    externalFixtureId: `fixture-${id}`,
    kickoffAt: "2026-10-19T20:00:00.000Z",
    homeTeamName: "Pérez Zeledón",
    awayTeamName: "CS Herediano",
    status: "finished",
    ratingState,
    votingPresentation,
    diagnostic: "unknown",
    participantCount: 21,
    rateableParticipantCount: 16,
    confirmedStarterCount: 11,
    confirmedSubstituteCount: 5,
    unconfirmedOrUnusedCount: 5,
    headCoachReady: true,
    lineupProvenance: "operator_verified",
    assignment: {
      coachId: "coach-1",
      coachName: "Jafet Soto",
      provenance: "operator_verified",
    },
  };
}
