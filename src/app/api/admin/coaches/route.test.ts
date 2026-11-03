import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthorizationError } from "@/lib/server/admin-auth";
import {
  CoachSearchIndexIncompleteError,
  CoachSearchInvalidInputError,
} from "@/lib/firebase/coach-search-index";
import type * as AdminRequestModule from "@/lib/server/admin-request";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  searchCoaches: vi.fn(),
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
    searchCoaches = mocks.searchCoaches;
  },
}));

import { GET } from "./route";

function request(club = "herediano", extra = "") {
  return new NextRequest(
    `https://rating.test/api/admin/coaches?club=${club}&matchId=match-1&fixtureId=1551706${extra}`,
  );
}

describe("owner coach discovery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ uid: "owner" });
    mocks.searchCoaches.mockResolvedValue({
      coaches: [{ id: "coach-1", name: "Director", provenance: "provider" }],
      nextCursor: "cursor-1",
    });
  });

  it("binds Match discovery to the trusted selected Team", async () => {
    const response = await GET(
      request("saprissa", "&query=director&scope=team"),
    );
    expect(response.status).toBe(200);
    expect(mocks.searchCoaches).toHaveBeenCalledWith(
      "match-1",
      "deportivo-saprissa",
      "1551706",
      "team",
      "director",
      undefined,
    );
    await expect(response.json()).resolves.toMatchObject({
      coaches: [{ id: "coach-1" }],
      nextCursor: "cursor-1",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects non-owner, missing club and wrong-club Match reads", async () => {
    mocks.requireAdminRequest.mockRejectedValueOnce(
      new AdminAuthorizationError(403),
    );
    expect((await GET(request())).status).toBe(403);
    expect(mocks.searchCoaches).not.toHaveBeenCalled();
    expect(
      (
        await GET(
          new NextRequest(
            "https://rating.test/api/admin/coaches?matchId=match-1&fixtureId=1551706",
          ),
        )
      ).status,
    ).toBe(403);
    mocks.searchCoaches.mockResolvedValueOnce(null);
    expect((await GET(request("saprissa"))).status).toBe(404);
  });

  it("fails safely for malformed input and incomplete index", async () => {
    expect((await GET(request("unknown"))).status).toBe(403);
    expect((await GET(request("herediano", "&matchId=other"))).status).toBe(
      400,
    );
    mocks.searchCoaches.mockRejectedValueOnce(
      new CoachSearchInvalidInputError(),
    );
    expect((await GET(request("herediano", "&cursor=invalid"))).status).toBe(
      400,
    );
    mocks.searchCoaches.mockRejectedValueOnce(
      new CoachSearchIndexIncompleteError(),
    );
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("no está preparado");
  });
});
