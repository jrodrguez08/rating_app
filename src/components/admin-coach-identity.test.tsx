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

  it("uses the same guided review and authorization for a suggestion", async () => {
    const user = userEvent.setup();
    const fetchMock = apiMock();
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "rating_admin_csrf=test-csrf";
    renderComponent();

    expect(await screen.findByText(/Jafet Soto/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: messages.reviewSuggestedPair }),
    );
    const review = await screen.findByRole("heading", {
      name: messages.coachIdentityComparison,
    });
    expect(review).toHaveFocus();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(
      screen.getByRole("radio", {
        name: new RegExp(
          `Jafet Soto.*${messages.sourceManual}.*${messages.protectedHistory}`,
        ),
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", {
        name: new RegExp(`J\\. Soto.*${messages.sourceProvider}`),
      }),
    ).toBeDisabled();
    expect(screen.queryByText(manualId)).not.toBeInTheDocument();
    expect(screen.queryByText(providerId)).not.toBeInTheDocument();

    const samePerson = screen.getByRole("button", {
      name: messages.samePerson,
    });
    await waitFor(() => expect(samePerson).toBeEnabled());
    await user.click(samePerson);
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

  it("keeps manual search secondary and returns with both selections", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      apiMock({ providerDataAvailable: false, suggestions: [] }),
    );
    renderComponent();
    expect(
      await screen.findByText(messages.waitingForProviderCoaches),
    ).toBeVisible();
    const toggle = screen.getByRole("button", {
      name: messages.manualCoachSelection,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(await screen.findByLabelText(messages.searchCoaches)).toHaveFocus();
    const options = await screen.findAllByRole("button", {
      name: /Director (manual|proveedor)/,
    });
    await user.click(options[0]);
    await user.click(options[1]);
    expect(
      await screen.findByRole("heading", {
        name: messages.coachIdentityComparison,
      }),
    ).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: messages.editIdentitySelection }),
    );
    expect(await screen.findByLabelText(messages.searchCoaches)).toHaveFocus();
    expect(
      screen.getByRole("list", { name: messages.selectedIdentities }),
    ).toBeVisible();
  });

  it("retains the pair after a recoverable preview error", async () => {
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
  });

  it("keeps different-person authorization in the unified review", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", apiMock());
    renderComponent();
    await user.click(
      await screen.findByRole("button", { name: messages.reviewSuggestedPair }),
    );
    const different = await screen.findByRole("button", {
      name: messages.coachesDifferent,
    });
    await waitFor(() => expect(different).toBeEnabled());
    await user.click(different);
    expect(
      await screen.findByRole("button", {
        name: messages.confirmDifferentCoaches,
      }),
    ).toBeVisible();
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
  failPreviewAt?: number,
) {
  let previewCount = 0;
  const identities = new Map([
    [manualId, coach(manualId, "Jafet Soto", "operator_verified")],
    [providerId, coach(providerId, "J. Soto", "provider")],
  ]);
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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
      previewCount += 1;
      if (previewCount === failPreviewAt) {
        return response({ error: "Revise el historial protegido" }, 409);
      }
      const action = JSON.parse(String(init?.body)) as {
        firstCoachId: string;
        secondCoachId: string;
        canonicalCoachId: string;
        decision: "match" | "nonmatch";
      };
      const first =
        identities.get(action.firstCoachId) ??
        coach(action.firstCoachId, "Director manual", "operator_verified");
      const second =
        identities.get(action.secondCoachId) ??
        coach(action.secondCoachId, "Director proveedor", "provider");
      const canonical = action.canonicalCoachId === first.id ? first : second;
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
  return { id, name, identityProvenance, teamCount: 1, matchCount: 2 };
}

function evidence(value: ReturnType<typeof coach>) {
  return {
    ...value,
    hasProtectedHistory: value.identityProvenance === "operator_verified",
    verifiedAssignments:
      value.identityProvenance === "operator_verified" ? 1 : 0,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
