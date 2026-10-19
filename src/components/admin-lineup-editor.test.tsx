import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";

import { AdminLineupEditor } from "./admin-lineup-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const messages = getMessages("es").admin;

describe("admin lineup editor", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("preloads provider starters, bench, entrants, and unknown participation", () => {
    renderEditor(detail("preparing_rating"));

    expect(
      screen.getByRole("heading", { name: messages.starters }),
    ).toBeVisible();
    expect(screen.getByText("11/11")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: messages.availableSubstitutes }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: messages.enteredSubstitutes }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: messages.unconfirmedParticipation }),
    ).toBeVisible();
    expect(screen.getAllByText(/Proveedor/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Mover a Jugador 12" }),
    ).toHaveAttribute("aria-roledescription", "draggable");
    expect(
      screen.getByRole("button", { name: messages.applyLineup }),
    ).toBeEnabled();
  });

  it("marks a substitute as entered through a keyboard-accessible click action", async () => {
    const user = userEvent.setup();
    renderEditor(detail("preparing_rating"));
    const player = screen.getByText("Jugador 12").closest("li");
    expect(player).not.toBeNull();
    const markEntered = within(player!).getByRole("button", {
      name: messages.markEntered,
    });

    markEntered.focus();
    await user.keyboard("{Enter}");

    const movedPlayer = screen.getByText("Jugador 12").closest("li");
    expect(
      within(movedPlayer!).getByLabelText(messages.entryMinute),
    ).toBeVisible();
    expect(
      screen.getByText(
        messages.playerMoved
          .replace("{player}", "Jugador 12")
          .replace("{group}", messages.enteredSubstitutes),
      ),
    ).toBeVisible();
  });

  it("opens an accessible destination picker from Mover", async () => {
    const user = userEvent.setup();
    renderEditor(detail("preparing_rating"));
    const player = screen.getByText("Jugador 12").closest("li");
    expect(player).not.toBeNull();

    await user.click(
      within(player!).getByRole("button", {
        name: new RegExp(`^${messages.move}$`),
      }),
    );
    const destinations = within(player!).getByRole("group", {
      name: messages.moveDestination.replace("{player}", "Jugador 12"),
    });
    expect(
      within(destinations).getByRole("button", { name: messages.starters }),
    ).toBeDisabled();
    await user.click(
      within(destinations).getByRole("button", {
        name: messages.enteredSubstitutes,
      }),
    );

    const movedPlayer = screen.getByText("Jugador 12").closest("li");
    expect(
      within(movedPlayer!).getByLabelText(messages.entryMinute),
    ).toBeVisible();
    expect(
      screen.getByText(
        messages.playerMoved
          .replace("{player}", "Jugador 12")
          .replace("{group}", messages.enteredSubstitutes),
      ),
    ).toBeVisible();
  });

  it("restores the preloaded evidence after a local draft change", async () => {
    const user = userEvent.setup();
    renderEditor(detail("preparing_rating"));
    const player = screen.getByText("Jugador 12").closest("li");
    await user.click(
      within(player!).getByRole("button", { name: messages.markEntered }),
    );
    await user.click(
      screen.getByRole("button", { name: messages.restorePreload }),
    );

    const restoredPlayer = screen.getByText("Jugador 12").closest("li");
    expect(
      within(restoredPlayer!).queryByLabelText(messages.entryMinute),
    ).not.toBeInTheDocument();
    expect(screen.getByText(messages.draftRestored)).toBeVisible();
  });

  it("searches the owner-only canonical roster and adds one result", async () => {
    const user = userEvent.setup();
    const matchDetail = detail("preparing_rating");
    matchDetail.participants = matchDetail.participants.slice(0, 10);
    matchDetail.players = matchDetail.players.slice(0, 10);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          players: [
            {
              id: "canonical-new",
              name: "Jugador Canónico",
              position: "midfielder",
              identityProvenance: "provider",
            },
          ],
        }),
      }),
    );
    renderEditor(matchDetail);

    await user.type(screen.getByLabelText(messages.searchPlayers), "Canónico");
    const result = await screen.findByText("Jugador Canónico");
    const row = result.closest("li");
    await user.click(
      within(row!).getByRole("button", { name: messages.addStarter }),
    );

    expect(screen.getByText("11/11")).toBeVisible();
    expect(
      screen.getByRole("button", { name: messages.applyLineup }),
    ).toBeEnabled();
  });

  it("falls back to canonical roster search when no lineup was persisted", async () => {
    const user = userEvent.setup();
    const matchDetail = detail("not_ready");
    matchDetail.participants = [];
    matchDetail.players = [];
    delete matchDetail.match.lineupSnapshotAt;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          players: [
            {
              id: "canonical-fallback",
              name: "Jugador Disponible",
              identityProvenance: "provider",
            },
          ],
        }),
      }),
    );
    renderEditor(matchDetail);

    expect(screen.getByText("0/11")).toBeVisible();
    await user.type(
      screen.getByLabelText(messages.searchPlayers),
      "Disponible",
    );
    const result = await screen.findByText("Jugador Disponible");
    await user.click(
      within(result.closest("li")!).getByRole("button", {
        name: messages.addStarter,
      }),
    );

    expect(screen.getByText("1/11")).toBeVisible();
    expect(
      screen.getByRole("button", { name: messages.applyLineup }),
    ).toBeDisabled();
  });

  it("progressively loads and de-duplicates canonical roster pages", async () => {
    const user = userEvent.setup();
    const first = {
      id: "paged-one",
      name: "Jugador Primera Página",
      identityProvenance: "provider",
    } as const;
    const second = {
      id: "paged-two",
      name: "Jugador Segunda Página",
      identityProvenance: "provider",
    } as const;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ players: [first], nextCursor: "page-one" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ players: [first, second] }),
        }),
    );
    renderEditor(detail("preparing_rating"));

    expect(await screen.findByText(first.name)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: messages.loadMorePlayers }),
    );

    expect(await screen.findByText(second.name)).toBeVisible();
    expect(screen.getAllByText(first.name)).toHaveLength(1);
  });

  it("keeps internal identity creation secondary and explicitly verified", async () => {
    const user = userEvent.setup();
    const matchDetail = detail("preparing_rating");
    matchDetail.participants = matchDetail.participants.slice(0, 10);
    matchDetail.players = matchDetail.players.slice(0, 10);
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("internal-id")
        ? {
            ok: true,
            json: async () => ({
              playerId: `player-internal-${"a".repeat(32)}`,
              identityAllocationToken: "signed-allocation",
            }),
          }
        : { ok: true, json: async () => ({ players: [] }) },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(matchDetail);

    const createPlayer = screen
      .getByText(messages.newPlayer)
      .closest("details");
    expect(createPlayer).not.toHaveAttribute("open");
    await user.click(screen.getByText(messages.newPlayer));
    await user.type(
      screen.getByLabelText(messages.playerName),
      "Jugador Verificado",
    );
    const addStarter = screen.getAllByRole("button", {
      name: messages.addStarter,
    })[0];
    expect(addStarter).toBeDisabled();
    await user.click(
      screen.getByLabelText(messages.internalIdentityConfirmation),
    );
    expect(addStarter).toBeEnabled();
    await user.click(addStarter);
    expect(screen.getByText("11/11")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/players/internal-id",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("prevents a twelfth starter and keeps substitute participation explicit", async () => {
    const user = userEvent.setup();
    renderEditor(detail("preparing_rating"));
    const player = screen.getByText("Jugador 12").closest("li");
    expect(
      within(player!).getByRole("button", { name: messages.addStarter }),
    ).toBeDisabled();
    expect(
      within(player!).getByRole("button", { name: messages.markEntered }),
    ).toBeEnabled();
    await user.click(
      within(player!).getByRole("button", { name: messages.markEntered }),
    );
    expect(screen.getByText("11/11")).toBeVisible();
  });

  it("submits the canonical name for an existing Player while preserving the editor", async () => {
    const user = userEvent.setup();
    const matchDetail = detail("preparing_rating");
    matchDetail.participants[0].playerName = "  JUGADOR 1 ";
    let previewBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async (input: string | URL | Request, init) => {
          if (String(input).includes("/api/admin/lineup/preview")) {
            previewBody = JSON.parse(String(init?.body));
            return {
              ok: true,
              json: async () => ({ plan: {}, previewToken: "preview-token" }),
            };
          }
          if (String(input).includes("/api/admin/lineup/authorize")) {
            return { ok: true, json: async () => ({ authorized: true }) };
          }
          if (String(input).includes("/api/admin/lineup/apply")) {
            return { ok: true, json: async () => ({ auditId: "audit" }) };
          }
          return { ok: true, json: async () => ({ players: [] }) };
        }),
    );
    renderEditor(matchDetail);

    await user.type(
      screen.getByLabelText(messages.passphrase),
      "owner passphrase",
    );
    await user.click(
      screen.getByRole("button", { name: messages.applyLineup }),
    );

    await waitFor(() => expect(previewBody).toBeDefined());
    const submitted = previewBody as {
      participants: Array<{ playerId: string; playerName: string }>;
    };
    expect(submitted.participants[0]).toMatchObject({
      playerId: matchDetail.players[0].id,
      playerName: matchDetail.players[0].name,
    });
    expect(
      screen.getAllByText("JUGADOR 1", { exact: false }).length,
    ).toBeGreaterThan(0);
  });

  it("keeps voting and completed matches read-only", () => {
    renderEditor(detail("rating_ready"));
    expect(screen.getByText(messages.historicalReadOnly)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Generar vista previa/i }),
    ).not.toBeInTheDocument();
  });

  it("shows loading and empty roster search states", async () => {
    const user = userEvent.setup();
    let resolveSearch: ((value: unknown) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
      ),
    );
    renderEditor(detail("preparing_rating"));
    await user.type(screen.getByLabelText(messages.searchPlayers), "Ausente");

    await waitFor(() =>
      expect(screen.getByText(messages.searchingPlayers)).toBeVisible(),
    );
    resolveSearch?.({ ok: true, json: async () => ({ players: [] }) });
    await waitFor(() =>
      expect(screen.getByText(messages.noPlayers)).toBeVisible(),
    );
  });

  it("saves an incomplete draft and reports the saved state", async () => {
    const user = userEvent.setup();
    const matchDetail = detail("not_ready");
    matchDetail.participants = matchDetail.participants.slice(0, 5);
    matchDetail.players = matchDetail.players.slice(0, 5);
    let resolveDraft:
      | ((value: {
          ok: boolean;
          json: () => Promise<{ version: number; disposition: string }>;
        }) => void)
      | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        String(input).includes("lineup-draft")
          ? new Promise((resolve) => {
              resolveDraft = resolve;
            })
          : Promise.resolve({
              ok: true,
              json: async () => ({ players: [] }),
            }),
      ),
    );
    renderEditor(matchDetail);

    await user.click(screen.getByRole("button", { name: messages.saveDraft }));
    expect(screen.getByText(messages.draftStatuses.saving)).toBeVisible();
    resolveDraft?.({
      ok: true,
      json: async () => ({ version: 1, disposition: "committed" }),
    });

    await waitFor(() =>
      expect(screen.getByText(messages.draftStatuses.saved)).toBeVisible(),
    );
    expect(screen.getByText(messages.draftSaved)).toBeVisible();
  });

  it("recovers from a draft save error and keeps changes unsaved", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("lineup-draft")
          ? { ok: false, json: async () => ({ error: "Versión obsoleta." }) }
          : { ok: true, json: async () => ({ players: [] }) },
      ),
    );
    renderEditor(detail("preparing_rating"));

    await user.click(screen.getByRole("button", { name: messages.saveDraft }));

    await waitFor(() =>
      expect(screen.getByText("Versión obsoleta.")).toBeVisible(),
    );
    expect(screen.getByText(messages.draftStatuses.error)).toBeVisible();
    expect(
      screen.getByRole("button", { name: messages.saveDraft }),
    ).toBeEnabled();
  });

  it("restores a persisted draft before provider evidence", () => {
    const matchDetail = detail("preparing_rating");
    matchDetail.draft = {
      matchId: matchDetail.match.id,
      trackedTeamId: "club-sport-herediano",
      externalFixtureId: matchDetail.match.externalFixtureId,
      ownerId: "owner-uid",
      version: 3,
      contentHash: "hash",
      participants: [
        {
          playerId: "player-12",
          playerName: "Jugador 12",
          createInternalIdentity: false,
          squadRole: "starter",
          participationStatus: "confirmed_starter",
        },
      ],
      createdAt: "2026-10-18T19:00:00.000Z",
      updatedAt: "2026-10-18T20:00:00.000Z",
    };

    renderEditor(matchDetail);

    expect(screen.getByText("1/11")).toBeVisible();
    expect(
      screen.getByText((content) =>
        content.includes(messages.savedDraftEvidence),
      ),
    ).toBeVisible();
    expect(screen.getByText(messages.draftStatuses.saved)).toBeVisible();
  });

  it("confirms the lineup through one owner form without technical evidence fields", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const path = String(input);
      if (path.includes("/api/admin/players?")) {
        return Promise.resolve(jsonResponse({ players: [] }));
      }
      if (path.endsWith("/preview")) {
        return Promise.resolve(
          jsonResponse({ previewToken: "lineup-preview", plan: {} }),
        );
      }
      if (path.endsWith("/authorize")) {
        return Promise.resolve(jsonResponse({ authorized: true }));
      }
      if (path.endsWith("/apply")) {
        return Promise.resolve(jsonResponse({ auditId: "lineup-audit" }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(detail("preparing_rating"));

    expect(
      screen.queryByLabelText(/enlace HTTPS de evidencia/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(messages.confirmation),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText(messages.passphrase),
      "independent-secret",
    );
    await user.click(
      screen.getByRole("button", { name: messages.applyLineup }),
    );

    expect(await screen.findByText(/lineup-audit/)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

function renderEditor(matchDetail: AdminMatchDetail) {
  return render(
    <AdminLineupEditor
      detail={matchDetail}
      messages={messages}
      teamId="club-sport-herediano"
    />,
  );
}

function detail(
  ratingState: AdminMatchDetail["match"]["ratingState"],
): AdminMatchDetail {
  const participants: AdminMatchDetail["participants"] = Array.from(
    { length: 14 },
    (_, index) => ({
      playerId: `player-${index + 1}`,
      playerName: `Jugador ${index + 1}`,
      squadRole: index < 11 ? "starter" : "substitute",
      participated: index < 11 || index === 12,
      participationStatus:
        index < 11
          ? "confirmed_starter"
          : index === 12
            ? "confirmed_substitute"
            : index === 13
              ? "unconfirmed"
              : "unused_substitute",
      identityProvenance: "provider",
      participationProvenance: "provider",
      ...(index === 12 ? { enteredAtMinute: 62 } : {}),
      shirtNumber: index + 1,
      position: index === 0 ? "goalkeeper" : "midfielder",
    }),
  );
  return {
    match: {
      id: "match-1",
      externalFixtureId: "fixture-1",
      kickoffAt: "2026-10-18T20:00:00.000Z",
      homeTeamName: "Herediano",
      awayTeamName: "Visitante",
      status: "finished",
      ratingState,
      votingPresentation:
        ratingState === "rating_ready"
          ? "open"
          : ratingState === "rating_closed"
            ? "published"
            : "preparation",
      lineupSnapshotAt: "2026-10-18T19:00:00.000Z",
      participantCount: participants.length,
      rateableParticipantCount: 12,
      confirmedStarterCount: 11,
      confirmedSubstituteCount: 1,
      unconfirmedOrUnusedCount: 2,
      headCoachReady: true,
      lineupProvenance: "provider",
    },
    participants,
    players: participants.map((participant) => ({
      id: participant.playerId,
      name: participant.playerName,
      position:
        participant.position === "goalkeeper" ? "goalkeeper" : "midfielder",
      identityProvenance: "provider",
    })),
    manualVotingAvailability: { state: "available" },
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}
