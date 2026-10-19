import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";
import { AdminAuthorizationError } from "@/lib/server/admin-auth";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  suggestions: vi.fn(),
}));

vi.mock(
  "@/lib/server/admin-request",
  async (importOriginal: () => Promise<typeof AdminRequestModule>) => {
    const actual = await importOriginal();
    return { ...actual, requireAdminRequest: mocks.requireAdminRequest };
  },
);

vi.mock("@/lib/firebase/admin-player-identity", () => ({
  AdminPlayerIdentityService: class {
    suggestions = mocks.suggestions;
  },
}));

import { GET } from "./route";

describe("admin Player identity suggestions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
    mocks.suggestions.mockResolvedValue({
      providerDataAvailable: true,
      suggestions: [],
    });
  });

  it("requires the owner session before reading suggestions", async () => {
    mocks.requireAdminRequest.mockRejectedValue(
      new AdminAuthorizationError(401),
    );
    const request = new NextRequest(
      "https://rating.test/api/admin/player-identities/suggestions",
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mocks.suggestions).not.toHaveBeenCalled();
  });

  it("returns suggestions from the tracked Team index", async () => {
    const request = new NextRequest(
      "https://rating.test/api/admin/player-identities/suggestions",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(request);
    expect(mocks.suggestions).toHaveBeenCalledWith("club-sport-herediano");
  });
});
