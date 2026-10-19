import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import { AdminIdentityReconciliation } from "./admin-identity-reconciliation";

const messages = getMessages("es").admin;

describe("admin identity tabs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("switches between Players and Coaches with keyboard tab semantics", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        if (path.includes("/coach-identities")) {
          return response(
            path.endsWith("/suggestions")
              ? { providerDataAvailable: false, suggestions: [] }
              : { coaches: [] },
          );
        }
        return response(
          path.endsWith("/suggestions")
            ? { providerDataAvailable: false, suggestions: [] }
            : { players: [] },
        );
      }),
    );
    render(
      <AdminIdentityReconciliation
        messages={messages}
        teamId="club-sport-herediano"
        teamName="Club Sport Herediano"
      />,
    );
    const players = screen.getByRole("tab", {
      name: messages.identityPlayersTab,
    });
    const coaches = screen.getByRole("tab", {
      name: messages.identityCoachesTab,
    });
    players.focus();
    await user.keyboard("{ArrowRight}");
    expect(coaches).toHaveFocus();
    expect(coaches).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText(messages.coachIdentityTitle)).toBeVisible();
  });
});

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
