import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import { AdminCoachIdentityReconciliation } from "./admin-coach-identity";

const messages = getMessages("es").admin;
const manualId = "coach-manual-jafet";
const providerId = "coach-provider-jafet";

describe("admin Coach identity reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reviews and applies a suggestion without exposing technical identities", async () => {
    const user = userEvent.setup();
    const fetchMock = apiMock();
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "rating_admin_csrf=test-csrf";
    renderComponent();

    expect(await screen.findByText("Jafet Soto")).toBeVisible();
    expect(screen.getByText("J. Soto")).toBeVisible();
    expect(screen.queryByText(manualId)).not.toBeInTheDocument();
    expect(screen.queryByText(providerId)).not.toBeInTheDocument();

    await user.click(
      screen.getByLabelText(`${messages.keepCoach}: Jafet Soto`),
    );
    await user.click(screen.getByRole("button", { name: messages.samePerson }));
    expect(await screen.findByText(messages.safeIdentityLink)).toBeVisible();
    await user.type(screen.getByLabelText(messages.passphrase), "passphrase");
    await user.click(
      screen.getByRole("button", { name: messages.consolidateCoaches }),
    );

    await waitFor(() => expect(screen.getByText(/audit-coach/)).toBeVisible());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/coach-identities/apply",
      expect.objectContaining({
        body: expect.stringContaining('"confirmed":true'),
      }),
    );
  });

  it("keeps manual selection available while provider data is pending", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      apiMock({ providerDataAvailable: false, suggestions: [] }),
    );
    renderComponent();

    expect(
      await screen.findByText(messages.waitingForProviderCoaches),
    ).toBeVisible();
    const options = await screen.findAllByRole("button", {
      name: /Director (manual|proveedor)/,
    });
    await user.click(options[0]);
    await user.click(options[1]);
    expect(options[0]).toBeDisabled();
    expect(options[1]).toBeDisabled();
  });

  it("preserves both selected Coaches after a recoverable preview error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", apiMock(undefined, true));
    renderComponent();
    const options = await screen.findAllByRole("button", {
      name: /Director (manual|proveedor)/,
    });
    await user.click(options[0]);
    await user.click(options[1]);
    await user.click(
      screen.getByLabelText(`${messages.keepCoach}: Director manual`),
    );
    await user.click(screen.getByRole("button", { name: messages.reviewPair }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Revise el historial protegido",
    );
    expect(options[0]).toBeDisabled();
    expect(options[1]).toBeDisabled();
  });
});

function renderComponent() {
  return render(
    <AdminCoachIdentityReconciliation
      messages={messages}
      teamName="Club Sport Herediano"
    />,
  );
}

function apiMock(
  suggestionResult: unknown = {
    providerDataAvailable: true,
    suggestions: [
      {
        first: coach(manualId, "Jafet Soto", "operator_verified"),
        second: coach(providerId, "J. Soto", "provider"),
        suggestedCanonicalCoachId: manualId,
        signals: ["abbreviation", "team"],
      },
    ],
  },
  previewFails = false,
) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = String(input);
    if (path.endsWith("/suggestions")) return response(suggestionResult);
    if (path.includes("/api/admin/coach-identities?")) {
      return response({
        coaches: [
          coach(manualId, "Director manual", "operator_verified"),
          coach(providerId, "Director proveedor", "provider"),
        ],
      });
    }
    if (path.endsWith("/preview")) {
      if (previewFails) {
        return response({ error: "Revise el historial protegido" }, 409);
      }
      return response({
        previewToken: "preview-token",
        plan: {
          decision: "match",
          status: "safe",
          canApply: true,
          explanation: "Se puede vincular.",
          canonical: evidence(manualId, "Director manual", "operator_verified"),
          duplicate: evidence(providerId, "Director proveedor", "provider"),
          proposedChanges: [],
          warnings: [],
        },
      });
    }
    if (path.endsWith("/authorize")) return response({ authorized: true });
    if (path.endsWith("/apply")) return response({ auditId: "audit-coach" });
    throw new Error(`Unexpected request ${path}`);
  });
}

function coach(
  id: string,
  name: string,
  identityProvenance: "provider" | "operator_verified",
) {
  return {
    id,
    name,
    identityProvenance,
    teamCount: 1,
    matchCount: 2,
  };
}

function evidence(
  id: string,
  name: string,
  identityProvenance: "provider" | "operator_verified",
) {
  return {
    ...coach(id, name, identityProvenance),
    hasProtectedHistory: false,
    verifiedAssignments: identityProvenance === "operator_verified" ? 1 : 0,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
