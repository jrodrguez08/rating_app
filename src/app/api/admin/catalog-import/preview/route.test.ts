import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthorizationError } from "@/lib/server/admin-auth";
import type * as AdminRequestModule from "@/lib/server/admin-request";
import type * as AdminCatalogImportModule from "@/lib/firebase/admin-catalog-import";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  preview: vi.fn(),
  issuePreview: vi.fn(),
  providerConstructed: vi.fn(),
}));

vi.mock(
  "@/lib/server/admin-request",
  async (importOriginal: () => Promise<typeof AdminRequestModule>) => {
    const actual = await importOriginal();
    return { ...actual, requireAdminRequest: mocks.requireAdminRequest };
  },
);
vi.mock("@/lib/server/environment", () => ({
  requireApiFootballRuntimeConfig: () => ({ apiFootballKey: "test-key" }),
}));
vi.mock("@/lib/providers/api-football/adapter", () => ({
  ApiFootballAdapter: class {
    name = "api-football";
    requestCount = 0;
    constructor() {
      mocks.providerConstructed();
    }
  },
}));
vi.mock("@/lib/firebase/admin-catalog-import", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof AdminCatalogImportModule;
  return {
    ...actual,
    AdminCatalogImportService: class {
      preview = mocks.preview;
    },
  };
});
vi.mock("@/lib/firebase/admin-security", () => ({
  AdminSecurityStore: class {
    issuePreview = mocks.issuePreview;
  },
}));

import { POST } from "./route";

function request(club: string, teamId: string) {
  return new NextRequest(
    `https://rating.test/api/admin/catalog-import/preview?club=${club}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackedTeamId: teamId }),
    },
  );
}

describe("admin catalog import preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ uid: "owner" });
    mocks.preview.mockResolvedValue({
      action: { trackedTeamId: "deportivo-saprissa" },
      plan: { playerCount: 1, coachCount: 1 },
    });
    mocks.issuePreview.mockResolvedValue({
      token: "signed",
      expiresAt: "2026-11-04T18:00:00.000Z",
    });
  });

  it("rejects a missing owner before provider construction", async () => {
    mocks.requireAdminRequest.mockRejectedValue(
      new AdminAuthorizationError(401),
    );
    expect((await POST(request("saprissa", "deportivo-saprissa"))).status).toBe(
      401,
    );
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("rejects wrong-club binding before provider construction", async () => {
    expect(
      (await POST(request("herediano", "deportivo-saprissa"))).status,
    ).toBe(403);
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
  });

  it("uses the selected club and signs the exact returned action", async () => {
    const response = await POST(request("saprissa", "deportivo-saprissa"));
    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith(
      "deportivo-saprissa",
      "owner",
      expect.objectContaining({ name: "api-football" }),
    );
    expect(mocks.issuePreview).toHaveBeenCalledWith("owner", {
      trackedTeamId: "deportivo-saprissa",
    });
  });
});
