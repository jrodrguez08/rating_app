import { act, render, screen, waitFor } from "@testing-library/react";
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
  it("loads another page and retains the selected coach across searches", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          coaches: [
            {
              id: "coach-first",
              name: "Primer Director",
              provenance: "provider",
            },
          ],
          nextCursor: "page-two",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          coaches: [
            {
              id: "coach-later",
              name: "Director Histórico",
              provenance: "operator_verified",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ coaches: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AdminMatchCoachPanel
        detail={detail("scheduled")}
        messages={messages}
        teamId="club-sport-herediano"
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: messages.coachLoadMore }),
    );
    await user.click(
      await screen.findByRole("radio", { name: /Director Histórico/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: messages.coachSearch }),
      "otro",
    );
    await user.click(
      screen.getByRole("button", { name: messages.coachSearchButton }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("status")).toHaveTextContent("Director Histórico");
    expect(screen.getByRole("button", { name: messages.apply })).toBeEnabled();
    expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=page-two");
  });

  it("ignores a delayed response after changing the candidate scope", async () => {
    const user = userEvent.setup();
    let resolveOld: (value: unknown) => void = () => undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          coaches: [
            { id: "coach-new", name: "Director Nuevo", provenance: "provider" },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AdminMatchCoachPanel
        detail={detail("scheduled")}
        messages={messages}
        teamId="club-sport-herediano"
      />,
    );
    await user.selectOptions(
      screen.getByLabelText(messages.coachScope),
      "unassociated",
    );
    await user.type(
      screen.getByRole("textbox", { name: messages.coachSearch }),
      "nuevo",
    );
    await user.click(
      screen.getByRole("button", { name: messages.coachSearchButton }),
    );
    expect(
      await screen.findByRole("radio", { name: /Director Nuevo/ }),
    ).toBeInTheDocument();
    await act(async () => {
      resolveOld({
        ok: true,
        json: async () => ({
          coaches: [
            {
              id: "coach-old",
              name: "Director Anterior",
              provenance: "provider",
            },
          ],
        }),
      });
    });
    expect(
      screen.queryByRole("radio", { name: /Director Anterior/ }),
    ).not.toBeInTheDocument();
  });

  it.each(["scheduled", "live"] as const)(
    "allows a canonical coach preview while provider status is %s",
    async (status) => {
      const user = userEvent.setup();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            coaches: [
              {
                id: "coach-existing",
                name: "Director Existente",
                provenance: "provider",
                externalProviderId: "42",
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ plan: {}, previewToken: "preview" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ authorized: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ auditId: "audit" }),
        });
      vi.stubGlobal("fetch", fetchMock);
      render(
        <AdminMatchCoachPanel
          detail={detail(status)}
          messages={messages}
          teamId="club-sport-herediano"
        />,
      );

      await user.click(
        await screen.findByRole("radio", { name: /Director Existente/ }),
      );
      expect(
        screen.queryByLabelText(/ID interno del director/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText(/enlace HTTPS de evidencia/i),
      ).not.toBeInTheDocument();
      await user.type(
        screen.getByLabelText(messages.passphrase),
        "owner passphrase",
      );
      await user.click(screen.getByRole("button", { name: messages.apply }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/coach-assignment/preview?club=herediano",
        expect.objectContaining({
          body: expect.stringContaining('"matchId":"match-coach"'),
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(4);
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
      votingPresentation: "preparation",
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
    manualVotingAvailability: { state: "available" },
  };
}
