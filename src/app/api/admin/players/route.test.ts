import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type * as AdminRequestModule from "@/lib/server/admin-request";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  searchPlayers: vi.fn(),
  observeRead: undefined as
    ((read: { kind: string; documents: number }) => void) | undefined,
}));

vi.mock(
  "@/lib/server/admin-request",
  async (importOriginal: () => Promise<typeof AdminRequestModule>) => {
    const actual = await importOriginal();
    return { ...actual, requireAdminRequest: mocks.requireAdminRequest };
  },
);

vi.mock("@/lib/firebase/admin-console", () => ({
  AdminConsoleService: class {
    constructor(_database?: unknown, observe?: typeof mocks.observeRead) {
      mocks.observeRead = observe;
    }
    searchPlayers = mocks.searchPlayers;
  },
}));

import { GET } from "./route";

describe("admin player search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
    mocks.searchPlayers.mockResolvedValue({
      players: [
        {
          id: "player-1",
          name: "Jugador Uno",
          position: "midfielder",
          identityProvenance: "provider",
        },
      ],
      nextCursor: "player-1",
    });
  });

  it("requires the owner session and returns bounded canonical results", async () => {
    const request = new NextRequest(
      "https://rating.test/api/admin/players?query=Jugador&club=herediano",
    );
    const response = await GET(request);

    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(request);
    expect(mocks.searchPlayers).toHaveBeenCalledWith(
      "club-sport-herediano",
      "Jugador",
      undefined,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      players: [{ id: "player-1", name: "Jugador Uno" }],
      nextCursor: "player-1",
    });
  });

  it("passes a validated pagination cursor to the catalog", async () => {
    const request = new NextRequest(
      "https://rating.test/api/admin/players?query=Jugador&cursor=player-20&club=herediano",
    );

    expect((await GET(request)).status).toBe(200);
    expect(mocks.searchPlayers).toHaveBeenCalledWith(
      "club-sport-herediano",
      "Jugador",
      "player-20",
    );
  });

  it("rejects an oversized search before reading the catalog", async () => {
    const request = new NextRequest(
      `https://rating.test/api/admin/players?query=${"a".repeat(81)}&club=herediano`,
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(mocks.searchPlayers).not.toHaveBeenCalled();
  });

  it("rejects an invalid cursor before reading the catalog", async () => {
    const request = new NextRequest(
      "https://rating.test/api/admin/players?cursor=players%2Fone&club=herediano",
    );

    expect((await GET(request)).status).toBe(400);
    expect(mocks.searchPlayers).not.toHaveBeenCalled();
  });

  it("logs read estimates and page counts without query, identity or cursor data", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      mocks.searchPlayers.mockImplementationOnce(async () => {
        mocks.observeRead?.({ kind: "index_state", documents: 1 });
        mocks.observeRead?.({ kind: "membership_query", documents: 21 });
        mocks.observeRead?.({ kind: "player_lookup", documents: 20 });
        mocks.observeRead?.({ kind: "alias_lookup", documents: 20 });
        return { players: [{ id: "private-player", name: "Private name" }] };
      });
      const response = await GET(
        new NextRequest(
          "https://rating.test/api/admin/players?query=private-query&cursor=private-cursor&club=herediano",
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const line = String(log.mock.calls[0][0]);
      expect(JSON.parse(line)).toMatchObject({
        event: "admin.player_search",
        teamId: "club-sport-herediano",
        queries: 1,
        membershipDocuments: 21,
        documentReadEstimate: 62,
        returnedPlayers: 1,
        status: "completed",
        clientAborted: false,
      });
      for (const privateValue of [
        "private-query",
        "private-cursor",
        "owner-uid",
        "private-player",
        "Private name",
      ])
        expect(line).not.toContain(privateValue);
    } finally {
      log.mockRestore();
    }
  });

  it("counts an empty membership query as one estimated read", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      mocks.searchPlayers.mockImplementationOnce(async () => {
        mocks.observeRead?.({ kind: "index_state", documents: 1 });
        mocks.observeRead?.({ kind: "membership_query", documents: 0 });
        return { players: [] };
      });
      await GET(
        new NextRequest(
          "https://rating.test/api/admin/players?query=absent&club=saprissa",
        ),
      );
      expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
        queries: 1,
        membershipDocuments: 0,
        documentReadEstimate: 2,
        returnedPlayers: 0,
      });
    } finally {
      log.mockRestore();
    }
  });
});
