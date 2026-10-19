import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";

import { AdminMatchCoachPanel } from "./admin-match-coach";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const messages = getMessages("es").admin;

afterEach(() => vi.unstubAllGlobals());

describe("match-specific verified coach panel", () => {
  it.each(["scheduled", "live"] as const)(
    "allows a canonical coach preview while provider status is %s",
    async (status) => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ plan: {}, previewToken: "preview" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      render(
        <AdminMatchCoachPanel
          detail={detail(status)}
          messages={messages}
          teamId="team-manual"
        />,
      );

      await user.selectOptions(
        screen.getByLabelText(messages.existingCoach),
        "coach-existing",
      );
      await user.type(
        screen.getByLabelText(messages.evidence),
        "https://example.com/coach",
      );
      await user.type(
        screen.getByLabelText(messages.reason),
        "Acta oficial revisada",
      );
      await user.click(screen.getByRole("button", { name: messages.preview }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/coach-assignment/preview",
        expect.objectContaining({
          body: expect.stringContaining('"matchId":"match-coach"'),
        }),
      );
    },
  );
});

function detail(status: "scheduled" | "live"): AdminMatchDetail {
  return {
    match: {
      id: "match-coach",
      externalFixtureId: "fixture-coach",
      kickoffAt: "2026-10-20T00:00:00.000Z",
      homeTeamName: "Local",
      awayTeamName: "Visitante",
      status,
      ratingState: "preparing_rating",
      participantCount: 11,
      rateableParticipantCount: 11,
      confirmedStarterCount: 11,
      confirmedSubstituteCount: 0,
      unconfirmedOrUnusedCount: 0,
      headCoachReady: false,
      lineupProvenance: "operator_verified",
    },
    participants: [],
    players: [],
    coaches: [
      {
        id: "coach-existing",
        name: "Director Existente",
        provenance: "provider",
        externalProviderId: "42",
      },
    ],
  };
}
