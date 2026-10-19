import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthorizationError } from "@/lib/server/admin-auth";
import type * as AdminRequestModule from "@/lib/server/admin-request";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  issuePreview: vi.fn(),
  requireAdminRequest: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-player-identity", () => ({
  AdminPlayerIdentityService: class {
    preview = mocks.preview;
  },
}));

vi.mock("@/lib/firebase/admin-security", () => ({
  AdminSecurityStore: class {
    issuePreview = mocks.issuePreview;
  },
}));

vi.mock(
  "@/lib/server/admin-request",
  async (importOriginal: () => Promise<typeof AdminRequestModule>) => {
    const actual = await importOriginal();
    return { ...actual, requireAdminRequest: mocks.requireAdminRequest };
  },
);

import { POST } from "./route";

const action = {
  firstPlayerId: "player-one",
  secondPlayerId: "player-two",
  canonicalPlayerId: "player-one",
  trackedTeamId: "club-sport-herediano",
  decision: "match",
};

describe("admin Player identity preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
    mocks.preview.mockResolvedValue({ status: "safe", canApply: true });
    mocks.issuePreview.mockResolvedValue({
      token: "preview-token",
      expiresAt: "2026-10-19T12:00:00.000Z",
    });
  });

  it("rejects a non-owner before previewing", async () => {
    mocks.requireAdminRequest.mockRejectedValue(
      new AdminAuthorizationError(401),
    );

    const response = await POST(request(action));

    expect(response.status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.issuePreview).not.toHaveBeenCalled();
  });

  it("previews without mutation and binds authorization to the exact action", async () => {
    const response = await POST(request(action));

    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith({
      ...action,
      operatorId: "owner-uid",
    });
    expect(mocks.issuePreview).toHaveBeenCalledWith("owner-uid", action);
  });

  it("rejects a different Team before service preview", async () => {
    const response = await POST(
      request({ ...action, trackedTeamId: "another-team" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.issuePreview).not.toHaveBeenCalled();
  });
});

function request(body: unknown): NextRequest {
  return new NextRequest(
    "https://rating.test/api/admin/player-identities/preview",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}
