import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      "/api/admin/players/internal-id?club=herediano",
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
      if (path.includes("/preview?")) {
        return Promise.resolve(
          jsonResponse({ previewToken: "lineup-preview", plan: {} }),
        );
      }
      if (path.includes("/authorize?")) {
        return Promise.resolve(jsonResponse({ authorized: true }));
      }
      if (path.includes("/apply?")) {
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

describe("lineup Player search requests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ players: [] })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const advance = async (milliseconds = 200) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  };

  it("debounces rapid input and does not poll while idle", async () => {
    renderEditor(detail("preparing_rating"));
    await advance();
    const search = screen.getByLabelText(messages.searchPlayers);
    for (const value of ["j", "ju", "jua"]) {
      fireEvent.change(search, { target: { value } });
      await advance(50);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(149);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the loaded browse page during lineup edits without refetching", async () => {
    renderEditor(detail("preparing_rating"));
    await advance();
    for (let change = 0; change < 3; change++) {
      const row = screen.getByText("Jugador 12").closest("li")!;
      fireEvent.click(
        within(row).getByRole("button", {
          name: change % 2 ? messages.markNotEntered : messages.markEntered,
        }),
      );
      await advance();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates equivalent queries and debounces clear-and-type transitions", async () => {
    renderEditor(detail("preparing_rating"));
    await advance();
    const search = screen.getByLabelText(messages.searchPlayers);
    fireEvent.change(search, { target: { value: "aguil" } });
    await advance();
    fireEvent.change(search, { target: { value: "aguil " } });
    await advance();
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.change(search, { target: { value: "" } });
    await advance(50);
    fireEvent.change(search, { target: { value: "jua" } });
    await advance();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("aborts old pagination and ignores it even when its response arrives later", async () => {
    const old = {
      id: "old-page",
      name: "Old page Player",
      identityProvenance: "provider",
    };
    const fresh = {
      id: "fresh",
      name: "Fresh search Player",
      identityProvenance: "provider",
    };
    let resolvePage!: (response: ReturnType<typeof jsonResponse>) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ players: [], nextCursor: "page-1" }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePage = resolve;
          }),
      )
      .mockResolvedValueOnce(jsonResponse({ players: [fresh] }));
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(detail("preparing_rating"));
    await advance();
    fireEvent.click(
      screen.getByRole("button", { name: messages.loadMorePlayers }),
    );
    fireEvent.change(screen.getByLabelText(messages.searchPlayers), {
      target: { value: "fresh" },
    });
    await advance();
    expect(screen.getByText(fresh.name)).toBeVisible();
    expect(fetchMock.mock.calls[1][1]?.signal.aborted).toBe(true);
    await act(async () => {
      resolvePage(jsonResponse({ players: [old], nextCursor: "old-cursor" }));
    });
    expect(screen.queryByText(old.name)).not.toBeInTheDocument();
    expect(screen.getByText(fresh.name)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: messages.loadMorePlayers }),
    ).not.toBeInTheDocument();
  });

  it("ignores an obsolete first-page body after cancellation", async () => {
    const old = {
      id: "old-body",
      name: "Obsolete body Player",
      identityProvenance: "provider",
    };
    const fresh = {
      id: "latest-body",
      name: "Latest body Player",
      identityProvenance: "provider",
    };
    let resolveBody!: (value: unknown) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            resolveBody = resolve;
          }),
      })
      .mockResolvedValueOnce(jsonResponse({ players: [fresh] }));
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(detail("preparing_rating"));
    await advance();
    fireEvent.change(screen.getByLabelText(messages.searchPlayers), {
      target: { value: "latest" },
    });
    await advance();
    expect(fetchMock.mock.calls[0][1]?.signal.aborted).toBe(true);
    await act(async () => {
      resolveBody({ players: [old], nextCursor: "old-cursor" });
    });
    expect(screen.getByText(fresh.name)).toBeVisible();
    expect(screen.queryByText(old.name)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: messages.loadMorePlayers }),
    ).not.toBeInTheDocument();
  });

  it("filters selection locally while retaining unselected browse results", async () => {
    const player = {
      id: "available-browse",
      name: "Available browse Player",
      identityProvenance: "provider",
    };
    const another = {
      id: "another-browse",
      name: "Another browse Player",
      identityProvenance: "provider",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ players: [player, another] })),
    );
    renderEditor(detail("preparing_rating"));
    await advance();
    const row = screen.getByText(player.name).closest("li")!;
    fireEvent.click(
      within(row).getByRole("button", { name: messages.addSubstitute }),
    );
    await advance();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(another.name)).toBeVisible();
    expect(screen.getAllByText(player.name)).toHaveLength(1);
  });

  it("aborts the previous club when the keyed workspace switches", async () => {
    const old = {
      id: "club-a-player",
      name: "Club A roster Player",
      identityProvenance: "provider",
    };
    const fresh = {
      id: "club-b-player",
      name: "Club B roster Player",
      identityProvenance: "provider",
    };
    let resolveBody!: (value: unknown) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            resolveBody = resolve;
          }),
      })
      .mockResolvedValueOnce(jsonResponse({ players: [fresh] }));
    vi.stubGlobal("fetch", fetchMock);
    const workspace = render(
      <AdminLineupEditor
        key="herediano:match"
        detail={detail("preparing_rating")}
        messages={messages}
        teamId="club-sport-herediano"
      />,
    );
    await advance();
    workspace.rerender(
      <AdminLineupEditor
        key="saprissa:match"
        detail={detail("preparing_rating")}
        messages={messages}
        teamId="deportivo-saprissa"
      />,
    );
    await advance();
    expect(fetchMock.mock.calls[0][1]?.signal.aborted).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toContain("club=saprissa");
    await act(async () => {
      resolveBody({ players: [old] });
    });
    expect(screen.getByText(fresh.name)).toBeVisible();
    expect(screen.queryByText(old.name)).not.toBeInTheDocument();
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
