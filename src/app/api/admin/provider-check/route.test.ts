import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminProviderCheckModule from "@/lib/firebase/admin-provider-check";
import type * as AdminRequestModule from "@/lib/server/admin-request";
import { AdminAuthorizationError } from "@/lib/server/admin-auth";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  check: vi.fn(),
  adapter: vi.fn(),
  runtimeConfig: vi.fn(),
}));

vi.mock("@/lib/server/admin-request", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRequestModule>();
  return { ...actual, requireAdminRequest: mocks.requireAdminRequest };
});
vi.mock("@/lib/firebase/admin-provider-check", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminProviderCheckModule>();
  return {
    ...actual,
    AdminProviderCheckService: class {
      check = mocks.check;
    },
  };
});
vi.mock("@/lib/providers/api-football/adapter", () => ({
  ApiFootballAdapter: class {
    constructor(...values: unknown[]) {
      mocks.adapter(...values);
    }
  },
}));
vi.mock("@/lib/server/environment", () => ({
  requireApiFootballRuntimeConfig: mocks.runtimeConfig,
}));

import { POST } from "./route";

const action = {
  matchId: "match-10a50b08075ca1f0646e5b6d",
  trackedTeamId: "club-sport-herediano",
  externalFixtureId: "1551706",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
  mocks.runtimeConfig.mockReturnValue({ apiFootballKey: "provider-secret" });
  mocks.check.mockResolvedValue({
    status: "available",
    checkedAt: "2026-10-21T12:00:00.000Z",
    providerRequests: 4,
  });
});

describe("admin provider check route", () => {
  it("authorizes owner, origin, and CSRF before checking the bound fixture", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(
      expect.any(NextRequest),
      true,
    );
    expect(mocks.check).toHaveBeenCalledWith({
      ...action,
      operatorId: "owner-uid",
    });
    expect(mocks.adapter).toHaveBeenCalledWith(
      "provider-secret",
      expect.any(Function),
      expect.any(Function),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects unauthorized and invalid-origin requests before provider setup", async () => {
    mocks.requireAdminRequest.mockRejectedValue(
      new AdminAuthorizationError(403),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.runtimeConfig).not.toHaveBeenCalled();
    expect(mocks.adapter).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
  });
});

function request() {
  return new NextRequest("http://localhost:3000/api/admin/provider-check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      "X-Admin-CSRF": "c".repeat(43),
    },
    body: JSON.stringify(action),
  });
}
