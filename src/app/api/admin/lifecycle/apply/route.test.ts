import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";
import { AdminAuthorizationError } from "@/lib/server/admin-auth";

const mocks = vi.hoisted(() => ({
  applyAuthorized: vi.fn(),
  requireAdminRequest: vi.fn(),
  runConfiguredLifecycle: vi.fn(),
}));

vi.mock("@/application/run-lifecycle", () => ({
  runConfiguredLifecycle: mocks.runConfiguredLifecycle,
}));

vi.mock("@/lib/firebase/admin-lifecycle", () => {
  class AdminLifecycleRejectedError extends Error {}
  return {
    AdminLifecycleRejectedError,
    AdminLifecycleService: class {
      applyAuthorized = mocks.applyAuthorized;
    },
  };
});

vi.mock("@/lib/firebase/server", () => ({
  AdminFootballSyncStore: class {},
  AdminVotingWindowNotificationStore: class {},
}));

vi.mock("@/lib/notifications/resend", () => ({
  readNotificationSiteUrl: vi.fn(),
  readResendNotificationConfig: vi.fn().mockReturnValue(null),
  ResendVotingWindowNotifier: class {},
}));

vi.mock("@/lib/server/environment", () => ({
  requireLifecycleRuntimeConfig: vi
    .fn()
    .mockReturnValue({ apiFootballKey: "provider-key" }),
}));

vi.mock("@/lib/server/admin-request", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRequestModule>();
  return { ...actual, requireAdminRequest: mocks.requireAdminRequest };
});

import { POST } from "./route";

const action = {
  matchId: "match-lifecycle-route",
  trackedTeamId: "club-sport-herediano",
  externalFixtureId: "fixture-lifecycle-route",
};

beforeEach(() => {
  mocks.applyAuthorized.mockReset();
  mocks.requireAdminRequest.mockReset();
  mocks.runConfiguredLifecycle.mockReset();
  mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
  mocks.runConfiguredLifecycle.mockResolvedValue({
    action: "preparing_rating",
    matchId: action.matchId,
    providerRequests: 4,
    reason: "sensitive provider detail",
    logs: [],
  });
});

describe("admin lifecycle apply route", () => {
  it("runs the canonical lifecycle once for a committed owner request", async () => {
    mocks.applyAuthorized.mockResolvedValue({
      auditId: "lifecycle-audit",
      disposition: "committed",
    });

    const response = await POST(applyRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runConfiguredLifecycle).toHaveBeenCalledTimes(1);
    expect(mocks.runConfiguredLifecycle).toHaveBeenCalledWith(
      "club-sport-herediano",
      expect.anything(),
      "provider-key",
      undefined,
      expect.anything(),
      { trigger: "operator" },
    );
    expect(body.lifecycle).toEqual({
      action: "preparing_rating",
      matchId: action.matchId,
      providerRequests: 4,
    });
  });

  it("returns an idempotent receipt without invoking the lifecycle twice", async () => {
    mocks.applyAuthorized.mockResolvedValue({
      auditId: "lifecycle-audit",
      disposition: "idempotent_retry",
    });

    const response = await POST(applyRequest());

    expect(response.status).toBe(200);
    expect(mocks.runConfiguredLifecycle).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated and inexact requests before provider work", async () => {
    mocks.requireAdminRequest.mockRejectedValueOnce(
      new AdminAuthorizationError(401),
    );
    expect((await POST(applyRequest())).status).toBe(401);
    expect(mocks.applyAuthorized).not.toHaveBeenCalled();
    expect(mocks.runConfiguredLifecycle).not.toHaveBeenCalled();

    mocks.requireAdminRequest.mockResolvedValueOnce({ uid: "owner-uid" });
    expect((await POST(applyRequest("wrong"))).status).toBe(400);
    expect(mocks.applyAuthorized).not.toHaveBeenCalled();
    expect(mocks.runConfiguredLifecycle).not.toHaveBeenCalled();
  });
});

function applyRequest(confirmation = `request-lifecycle:${action.matchId}`) {
  const csrf = "a".repeat(43);
  return new NextRequest("http://localhost:3000/api/admin/lifecycle/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `rating_admin_lifecycle_action=${"b".repeat(43)}; rating_admin_csrf=${csrf}`,
      Origin: "http://localhost:3000",
      "X-Admin-CSRF": csrf,
    },
    body: JSON.stringify({ action, confirmation }),
  });
}
