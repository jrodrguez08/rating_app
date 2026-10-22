import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import { AdminPlayerIdentityReconciliation } from "./admin-player-identity";

const messages = getMessages("es").admin;
const manualId = `player-internal-${"a".repeat(32)}`;
const providerId = "player-provider";

describe("admin Player identity reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens one guided suggestion review and applies its single keeper choice", async () => {
    const user = userEvent.setup();
    const fetchMock = apiMock();
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "rating_admin_csrf=test-csrf";
    renderComponent();

    expect(await screen.findByText(/D\. Gonzalez/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: messages.manualPlayerSelection }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByLabelText(messages.searchPlayers),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: messages.reviewSuggestedPair }),
    );
    const review = await screen.findByRole("heading", {
      name: messages.identityComparison,
    });
    expect(review).toHaveFocus();
    expect(
      screen.queryByRole("heading", { name: messages.possibleDuplicates }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    const manualChoice = screen.getByRole("radio", {
      name: new RegExp(
        `D\\. Gonzalez.*${messages.sourceManual}.*${messages.protectedHistory}`,
      ),
    });
    expect(manualChoice).toBeChecked();
    expect(
      screen.getByRole("radio", {
        name: new RegExp(`Daniel González.*${messages.sourceProvider}`),
      }),
    ).toBeDisabled();
    expect(screen.getByText(messages.recommendedIdentity)).toBeVisible();
    expect(screen.queryByText(manualId)).not.toBeInTheDocument();
    expect(screen.queryByText(providerId)).not.toBeInTheDocument();

    const samePerson = screen.getByRole("button", {
      name: messages.samePerson,
    });
    await waitFor(() => expect(samePerson).toBeEnabled());
    await user.click(samePerson);
    expect(await screen.findByText(messages.safeIdentityLink)).toBeVisible();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    await user.type(screen.getByLabelText(messages.passphrase), "passphrase");
    await user.click(
      screen.getByRole("button", { name: messages.consolidatePlayers }),
    );

    await waitFor(() => expect(screen.getByText(/audit-player/)).toBeVisible());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/player-identities/apply",
      expect.objectContaining({
        body: expect.stringContaining('"confirmed":true'),
      }),
    );
  });

  it("expands manual search, enters the same review, and returns with selections", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      apiMock({ providerDataAvailable: true, suggestions: [] }),
    );
    renderComponent();

    const toggle = await screen.findByRole("button", {
      name: messages.manualPlayerSelection,
    });
    await user.click(toggle);
    const search = await screen.findByLabelText(messages.searchPlayers);
    expect(search).toHaveFocus();
    const options = await screen.findAllByRole("button", {
      name: /Jugador (manual|proveedor)/,
    });
    await user.click(options[0]);
    await user.click(options[1]);
    expect(
      await screen.findByRole("heading", { name: messages.identityComparison }),
    ).toHaveFocus();

    await user.click(
      screen.getByRole("button", { name: messages.editIdentitySelection }),
    );
    expect(await screen.findByLabelText(messages.searchPlayers)).toHaveFocus();
    expect(
      screen.getByRole("list", { name: messages.selectedIdentities }),
    ).toBeVisible();
  });

  it("retains the reviewed pair and keeper after a recoverable error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", apiMock(undefined, 2));
    renderComponent();
    await user.click(
      await screen.findByRole("button", { name: messages.reviewSuggestedPair }),
    );
    const samePerson = await screen.findByRole("button", {
      name: messages.samePerson,
    });
    await waitFor(() => expect(samePerson).toBeEnabled());
    await user.click(samePerson);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Revise el historial protegido",
    );
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(
      screen.getByRole("radio", {
        name: new RegExp(`D\\. Gonzalez.*${messages.sourceManual}`),
      }),
    ).toBeChecked();
  });

  it("keeps different-person authorization in the guided flow", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", apiMock());
    renderComponent();
    await user.click(
      await screen.findByRole("button", { name: messages.reviewSuggestedPair }),
    );
    const different = await screen.findByRole("button", {
      name: messages.notSamePerson,
    });
    await waitFor(() => expect(different).toBeEnabled());
    await user.click(different);
    expect(
      await screen.findByRole("button", {
        name: messages.confirmDifferentPlayers,
      }),
    ).toBeVisible();
  });

  it("defers a suggestion without opening another comparison", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", apiMock());
    renderComponent();
    await screen.findByRole("button", { name: messages.reviewSuggestedPair });
    await user.click(
      screen.getByRole("button", { name: messages.reviewLater }),
    );
    expect(await screen.findByText(messages.noPendingDuplicates)).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: messages.identityComparison }),
    ).not.toBeInTheDocument();
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
  failPreviewAt?: number,
) {
  let previewCount = 0;
  const identities = new Map([
    [manualId, player(manualId, "D. Gonzalez", "operator_verified")],
    [providerId, player(providerId, "Daniel González", "provider")],
  ]);
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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
      previewCount += 1;
      if (previewCount === failPreviewAt) {
        return response({ error: "Revise el historial protegido" }, 409);
      }
      const action = JSON.parse(String(init?.body)) as {
        firstPlayerId: string;
        secondPlayerId: string;
        canonicalPlayerId: string;
        decision: "match" | "nonmatch";
      };
      const first =
        identities.get(action.firstPlayerId) ??
        player(action.firstPlayerId, "Jugador manual", "operator_verified");
      const second =
        identities.get(action.secondPlayerId) ??
        player(action.secondPlayerId, "Jugador proveedor", "provider");
      const canonical = action.canonicalPlayerId === first.id ? first : second;
      const duplicate = canonical.id === first.id ? second : first;
      return response({
        previewToken: "preview-token",
        plan: {
          decision: action.decision,
          status: action.decision === "match" ? "safe" : "confirmed_different",
          canApply: true,
          explanation: "La operación conserva el historial existente.",
          canonical: evidence(canonical),
          duplicate: evidence(duplicate),
          suggestedCanonicalPlayerId: manualId,
          proposedChanges: [],
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
      return response({ applied: true, auditId: "audit-player" });
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

function evidence(value: ReturnType<typeof player>) {
  return {
    playerId: value.id,
    name: value.name,
    identityProvenance: value.identityProvenance,
    position: value.position,
    matchCount: value.identityProvenance === "operator_verified" ? 1 : 0,
    hasProtectedHistory: value.identityProvenance === "operator_verified",
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
