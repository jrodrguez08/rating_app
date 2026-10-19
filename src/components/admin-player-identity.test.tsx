import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import { AdminPlayerIdentityReconciliation } from "./admin-player-identity";

const messages = getMessages("es").admin;
const manualId = `player-internal-${"a".repeat(32)}`;
const providerId = "player-provider";

describe("admin Player identity reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses a suggestion without exposing IDs or a typed confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = apiMock();
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "rating_admin_csrf=test-csrf";

    renderComponent();

    expect(await screen.findByText("D. Gonzalez")).toBeVisible();
    expect(screen.getByText("Daniel González")).toBeVisible();
    expect(screen.queryByText(manualId)).not.toBeInTheDocument();
    expect(screen.queryByText(providerId)).not.toBeInTheDocument();

    await user.click(
      screen.getByLabelText(`${messages.keepPlayer}: D. Gonzalez`),
    );
    await user.click(screen.getByRole("button", { name: messages.samePerson }));
    expect(await screen.findByText(messages.safeIdentityLink)).toBeVisible();
    expect(
      screen.queryByLabelText(messages.confirmation),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(messages.passphrase), {
      target: { value: "passphrase" },
    });
    await user.click(
      screen.getByRole("button", { name: messages.consolidatePlayers }),
    );

    await waitFor(() => expect(screen.getByText(/audit-1/)).toBeVisible());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/player-identities/apply",
      expect.objectContaining({
        body: expect.stringContaining('"confirmed":true'),
      }),
    );
  });

  it("allows manual selection of two distinct searchable Players", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", apiMock());

    renderComponent();

    const manualButtons = await screen.findAllByRole("button", {
      name: /Jugador (manual|proveedor)/,
    });
    await user.click(manualButtons[0]);
    await user.click(manualButtons[1]);
    expect(manualButtons[0]).toBeDisabled();
    expect(manualButtons[1]).toBeDisabled();

    await user.click(
      screen.getByLabelText(`${messages.keepPlayer}: Jugador manual`),
    );
    await user.click(screen.getByRole("button", { name: messages.reviewPair }));

    expect(await screen.findByText(messages.safeIdentityLink)).toBeVisible();
  });

  it("shows the provider waiting state without blocking manual selection", async () => {
    const fetchMock = apiMock({
      suggestions: [],
      providerDataAvailable: false,
    });
    vi.stubGlobal("fetch", fetchMock);

    renderComponent();

    expect(
      await screen.findByText(messages.waitingForProviderPlayers),
    ).toBeVisible();
    expect(await screen.findByLabelText(messages.searchPlayers)).toBeVisible();
  });
});

function renderComponent() {
  return render(
    <AdminPlayerIdentityReconciliation
      messages={messages}
      teamId="team-1"
      teamName="Club Sport Herediano"
    />,
  );
}

function apiMock(
  suggestionResult: unknown = {
    providerDataAvailable: true,
    suggestions: [
      {
        first: player(manualId, "D. Gonzalez", "operator_verified"),
        second: player(providerId, "Daniel González", "provider"),
        suggestedCanonicalPlayerId: manualId,
        signals: ["abbreviation", "position"],
      },
    ],
  },
) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = String(input);
    if (path.endsWith("/suggestions")) return response(suggestionResult);
    if (path.includes("/api/admin/players?")) {
      return response({
        players: [
          player(manualId, "Jugador manual", "operator_verified"),
          player(providerId, "Jugador proveedor", "provider"),
        ],
      });
    }
    if (path.endsWith("/preview")) {
      return response({
        previewToken: "preview-token",
        plan: {
          decision: "match",
          status: "safe",
          canApply: true,
          explanation: "Se puede vincular.",
          canonical: evidence(manualId, "Jugador manual", "operator_verified"),
          duplicate: evidence(providerId, "Jugador proveedor", "provider"),
          suggestedCanonicalPlayerId: manualId,
          proposedChanges: ["Conservar historial."],
          preservedReferences: {
            canonicalParticipations: 1,
            duplicateParticipations: 0,
            verifiedLineups: 0,
            ownerDrafts: 0,
            canonicalPublishedResults: 1,
            duplicatePublishedResults: 0,
          },
          warnings: [],
        },
      });
    }
    if (path.endsWith("/authorize")) return response({ authorized: true });
    if (path.endsWith("/apply")) {
      return response({ applied: true, auditId: "audit-1" });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function player(
  id: string,
  name: string,
  identityProvenance: "provider" | "operator_verified",
) {
  return { id, name, identityProvenance, position: "midfielder" as const };
}

function evidence(
  playerId: string,
  name: string,
  identityProvenance: "provider" | "operator_verified",
) {
  return {
    playerId,
    name,
    identityProvenance,
    matchCount: 1,
    hasProtectedHistory: identityProvenance === "operator_verified",
  };
}

function response(body: unknown) {
  return { ok: true, json: async () => body };
}
