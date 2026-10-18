import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";
import { AdminAuthorizationError } from "@/lib/server/admin-auth";

const mocks = vi.hoisted(() => ({
  inspectAuthorized: vi.fn(),
  requireAdminRequest: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-lifecycle", () => ({
  AdminLifecycleService: class {
    inspectAuthorized = mocks.inspectAuthorized;
  },
}));

vi.mock("@/lib/server/admin-request", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRequestModule>();
  return { ...actual, requireAdminRequest: mocks.requireAdminRequest };
});

import { POST } from "./route";

const action = {
  matchId: "match-lifecycle-status",
  trackedTeamId: "club-sport-herediano",
  externalFixtureId: "fixture-lifecycle-status",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
  mocks.inspectAuthorized.mockResolvedValue({
    auditId: "lifecycle-audit",
    status: "skipped_busy",
    retryable: true,
    statusCheckAvailable: true,
    requestAttempts: 1,
    providerExecutions: 0,
    createdAt: "2026-10-18T12:00:00.000Z",
    expiresAt: "2026-10-18T12:10:00.000Z",
    updatedAt: "2026-10-18T12:00:01.000Z",
  });
});

describe("admin lifecycle status route", () => {
  it("returns the durable receipt for the exact owner action", async () => {
    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipt: { auditId: "lifecycle-audit", status: "skipped_busy" },
    });
    expect(mocks.inspectAuthorized).toHaveBeenCalledWith(
      { ...action, operatorId: "owner-uid" },
      "b".repeat(43),
    );
  });

  it("rejects an unauthenticated status request", async () => {
    mocks.requireAdminRequest.mockRejectedValue(
      new AdminAuthorizationError(401),
    );

    expect((await POST(statusRequest())).status).toBe(401);
    expect(mocks.inspectAuthorized).not.toHaveBeenCalled();
  });
});

function statusRequest() {
  const csrf = "a".repeat(43);
  return new NextRequest("http://localhost:3000/api/admin/lifecycle/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `rating_admin_lifecycle_action=${"b".repeat(43)}; rating_admin_csrf=${csrf}`,
      Origin: "http://localhost:3000",
      "X-Admin-CSRF": csrf,
    },
    body: JSON.stringify(action),
  });
}
