import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type * as AdminRequestModule from "@/lib/server/admin-request";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  searchPlayers: vi.fn(),
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
    searchPlayers = mocks.searchPlayers;
  },
}));

import { GET } from "./route";

describe("admin player search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
    mocks.searchPlayers.mockResolvedValue([
      {
        id: "player-1",
        name: "Jugador Uno",
        position: "midfielder",
        identityProvenance: "provider",
      },
    ]);
  });

  it("requires the owner session and returns bounded canonical results", async () => {
    const request = new NextRequest(
      "https://rating.test/api/admin/players?query=Jugador",
    );
    const response = await GET(request);

    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(request);
    expect(mocks.searchPlayers).toHaveBeenCalledWith("Jugador");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      players: [{ id: "player-1", name: "Jugador Uno" }],
    });
  });

  it("rejects an oversized search before reading the catalog", async () => {
    const request = new NextRequest(
      `https://rating.test/api/admin/players?query=${"a".repeat(81)}`,
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(mocks.searchPlayers).not.toHaveBeenCalled();
  });
});
