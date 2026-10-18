import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

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
});
