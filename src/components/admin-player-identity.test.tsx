import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import { AdminPlayerIdentityReconciliation } from "./admin-player-identity";

const messages = getMessages("es").admin;
const canonicalPlayerId = `player-internal-${"a".repeat(32)}`;

describe("admin Player identity reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("previews both identities and requires authorization before apply", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.includes("/api/admin/players?")) {
        return response({
          players: [
            {
              id: canonicalPlayerId,
              name: "Jugador verificado",
              identityProvenance: "operator_verified",
            },
            {
              id: "provider-player",
              name: "Jugador proveedor",
              identityProvenance: "provider",
            },
          ],
        });
      }
      if (path.endsWith("/preview")) {
        return response({
          previewToken: "preview-token",
          plan: {
            decision: "match",
            canonical: {
              playerId: canonicalPlayerId,
              name: "Jugador verificado",
              matchIds: ["match-1"],
            },
            provider: {
              playerId: "provider-player",
              name: "Jugador proveedor",
              externalProviderId: "12345",
              matchIds: ["match-2"],
            },
            proposedChanges: ["Crear alias revisado."],
            preservedReferences: {
              canonicalParticipations: 1,
              providerParticipations: 1,
              verifiedLineups: 1,
              ownerDrafts: 0,
              canonicalPublishedResults: 0,
              providerPublishedResults: 0,
            },
            warnings: ["Revise la evidencia independiente."],
          },
        });
      }
      if (path.endsWith("/authorize")) return response({ authorized: true });
      if (path.endsWith("/apply")) {
        return response({ applied: true, auditId: "audit-1" });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "rating_admin_csrf=test-csrf";

    render(
      <AdminPlayerIdentityReconciliation messages={messages} teamId="team-1" />,
    );
    fireEvent.change(screen.getByLabelText(messages.searchManualPlayer), {
      target: { value: "Jugador" },
    });
    await user.click(await screen.findByText(new RegExp(canonicalPlayerId)));
    fireEvent.change(screen.getByLabelText(messages.apiFootballPlayerId), {
      target: { value: "12345" },
    });
    fireEvent.change(screen.getByLabelText(messages.evidence), {
      target: { value: "https://evidence.example.test/player" },
    });
    fireEvent.change(screen.getByLabelText(messages.reason), {
      target: { value: "Evidencia oficial revisada de forma independiente." },
    });
    await user.click(screen.getByRole("button", { name: messages.samePerson }));

    expect(await screen.findByText(messages.identityComparison)).toBeVisible();
    expect(screen.getByText("Crear alias revisado.")).toBeVisible();
    expect(
      screen.getByText("Revise la evidencia independiente."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: messages.applyIdentityDecision }),
    ).not.toBeInTheDocument();

    const passphrase = screen.getByLabelText(messages.passphrase);
    fireEvent.change(passphrase, {
      target: { value: "passphrase" },
    });
    await user.click(screen.getByRole("button", { name: messages.authorize }));
    expect(
      await screen.findByText(messages.authorizationSuccess),
    ).toBeVisible();
    expect(passphrase).toHaveValue("");
    const apply = await screen.findByRole("button", {
      name: messages.applyIdentityDecision,
    });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText(messages.confirmation), {
      target: { value: `reconcile-player:${canonicalPlayerId}` },
    });
    await user.click(apply);

    await waitFor(() => expect(screen.getByText(/audit-1/)).toBeVisible());
  });
});

function response(body: unknown) {
  return { ok: true, json: async () => body };
}
