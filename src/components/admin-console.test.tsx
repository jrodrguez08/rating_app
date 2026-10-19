import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";
import type {
  AdminMatchOperation,
  AdminOverview,
} from "@/lib/firebase/admin-console";

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

  it("removes the legacy coach form and groups every authoritative match state", () => {
    render(<AdminConsole messages={messages} overview={dashboardOverview()} />);

    expect(
      screen.queryByText("Recuperación de director técnico"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("ID interno del director"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Plan de cambios/)).not.toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: messages.openVotingSection }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: messages.preparationSection }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: messages.reviewSection }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: messages.closedVotingSection }),
    ).toBeVisible();
    expect(screen.getByText(messages.votingPresentation.open)).toBeVisible();
    expect(screen.getByText(messages.votingPresentation.expired)).toBeVisible();
    expect(
      screen.getByText(messages.votingPresentation.published),
    ).toBeVisible();
    expect(
      screen.queryByText(messages.diagnostics.unknown),
    ).not.toBeInTheDocument();
  });

  it("shows readable match details without technical identifiers", () => {
    render(<AdminConsole messages={messages} overview={dashboardOverview()} />);

    const upcoming = matchCard("Cartaginés");
    expect(upcoming).not.toBeNull();
    const card = within(upcoming!);
    expect(card.getByText(/CS Herediano.*Cartaginés/)).toBeVisible();
    expect(card.getByText(/Titulares confirmados: 11\/11/)).toBeVisible();
    expect(card.getByText(/Suplentes que ingresaron: 3/)).toBeVisible();
    expect(card.getByText(/Director técnico: Jafet Soto/)).toBeVisible();
    expect(card.getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-10-20T02:00:00.000Z",
    );
    expect(screen.queryByText(/fixture-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/match-/)).not.toBeInTheDocument();
  });

  it("uses one valid context-specific destination for each match", () => {
    render(<AdminConsole messages={messages} overview={dashboardOverview()} />);

    expect(matchLink("Cartaginés", messages.prepareMatch)).toHaveAttribute(
      "href",
      "/admin/matches/upcoming",
    );
    expect(matchLink("Pérez Zeledón", messages.viewVoting)).toHaveAttribute(
      "href",
      "/matches/open/rate",
    );
    expect(matchLink("Saprissa", messages.inspect)).toHaveAttribute(
      "href",
      "/admin/matches/expired",
    );
    expect(matchLink("Alajuelense", messages.viewResults)).toHaveAttribute(
      "href",
      "/matches/published/results",
    );
    expect(matchLink("Liberia", messages.inspect)).toHaveAttribute(
      "href",
      "/admin/matches/invalid",
    );
  });

  it("keeps reconciliation, refresh, and sign out accessible by keyboard", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole messages={messages} overview={emptyOverview()} />);

    const toolbar = screen.getByRole("navigation", {
      name: messages.adminActions,
    });
    expect(
      within(toolbar).getByRole("link", {
        name: messages.identityReconciliation,
      }),
    ).toHaveAttribute("href", "/admin/player-identities");

    await user.tab();
    expect(
      within(toolbar).getByRole("link", {
        name: messages.identityReconciliation,
      }),
    ).toHaveFocus();
    await user.tab();
    expect(
      within(toolbar).getByRole("button", { name: messages.refresh }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await user.tab();
    const logout = within(toolbar).getByRole("button", {
      name: messages.signOut,
    });
    expect(logout).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/session/logout",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("renders read-only navigation without issuing a request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole messages={messages} overview={dashboardOverview()} />);

    expect(
      screen.getByRole("link", { name: messages.viewVoting }),
    ).toHaveAttribute("href", "/matches/open/rate");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function matchLink(teamName: string, actionName: string) {
  const card = matchCard(teamName);
  expect(card).not.toBeNull();
  expect(within(card!).getAllByRole("link")).toHaveLength(1);
  return within(card!).getByRole("link", { name: actionName });
}

function matchCard(teamName: string) {
  return screen
    .getByText(
      (_, element) =>
        element?.tagName === "STRONG" &&
        element.textContent?.includes(teamName) === true,
    )
    .closest("li");
}

function dashboardOverview(): AdminOverview {
  return {
    upcomingLiveMatches: [
      operation("preparation", "not_ready", "upcoming", {
        awayTeamName: "Cartaginés",
        status: "scheduled",
        confirmedSubstituteCount: 3,
      }),
    ],
    attentionMatches: [
      operation("invalid", "rating_ready", "invalid", {
        awayTeamName: "Liberia",
      }),
    ],
    votingCompletedMatches: [
      operation("open", "rating_ready", "open", {
        awayTeamName: "Pérez Zeledón",
      }),
      operation("expired", "rating_ready", "expired", {
        awayTeamName: "Saprissa",
      }),
      operation("published", "rating_closed", "published", {
        awayTeamName: "Alajuelense",
      }),
    ],
  };
}

function emptyOverview(): AdminOverview {
  return {
    upcomingLiveMatches: [],
    attentionMatches: [],
    votingCompletedMatches: [],
  };
}

function operation(
  votingPresentation: AdminMatchOperation["votingPresentation"],
  ratingState: AdminMatchOperation["ratingState"],
  id: string,
  overrides: Partial<AdminMatchOperation> = {},
): AdminMatchOperation {
  return {
    id,
    externalFixtureId: `fixture-${id}`,
    kickoffAt: "2026-10-20T02:00:00.000Z",
    homeTeamName: "CS Herediano",
    awayTeamName: "Rival",
    status: "finished",
    ratingState,
    votingPresentation,
    diagnostic: "unknown",
    participantCount: 19,
    rateableParticipantCount: 14,
    confirmedStarterCount: 11,
    confirmedSubstituteCount: 3,
    unconfirmedOrUnusedCount: 5,
    headCoachReady: true,
    lineupProvenance: "operator_verified",
    assignment: {
      coachId: "coach-1",
      coachName: "Jafet Soto",
      provenance: "operator_verified",
    },
    ...overrides,
  };
}
