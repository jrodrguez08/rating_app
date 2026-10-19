import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthorizationError } from "@/lib/server/admin-auth";
import type * as AdminRequestModule from "@/lib/server/admin-request";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  issuePreview: vi.fn(),
  requireAdminRequest: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-coach-identity", () => ({
  AdminCoachIdentityRejectedError: class extends Error {},
  AdminCoachIdentityService: class {
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
  firstCoachId: "coach-one",
  secondCoachId: "coach-two",
  canonicalCoachId: "coach-one",
  decision: "match",
};

describe("admin Coach identity preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
    mocks.preview.mockResolvedValue({ status: "safe", canApply: true });
    mocks.issuePreview.mockResolvedValue({
      token: "preview-token",
      expiresAt: "2026-10-19T12:00:00.000Z",
    });
  });

  it("rejects an unauthorized request before reading a plan", async () => {
    mocks.requireAdminRequest.mockRejectedValue(
      new AdminAuthorizationError(401),
    );
    const response = await POST(request(action));
    expect(response.status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.issuePreview).not.toHaveBeenCalled();
  });

  it("runs zero-write preview and binds authorization to the exact action", async () => {
    const response = await POST(request(action));
    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith({
      ...action,
      operatorId: "owner-uid",
    });
    expect(mocks.issuePreview).toHaveBeenCalledWith("owner-uid", action);
  });
});

function request(body: unknown) {
  return new NextRequest(
    "https://rating.test/api/admin/coach-identities/preview",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}
