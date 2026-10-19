import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";
import { AdminAuthorizationError } from "@/lib/server/admin-auth";

const mocks = vi.hoisted(() => ({
  applyAuthorized: vi.fn(),
  notify: vi.fn(),
  requireAdminRequest: vi.fn(),
}));

vi.mock("@/application/voting-window-notification", () => ({
  notifyVotingWindowOpenedIfPending: mocks.notify,
}));
vi.mock("@/lib/firebase/admin-manual-voting", () => ({
  AdminManualVotingService: class {
    applyAuthorized = mocks.applyAuthorized;
  },
}));
vi.mock("@/lib/firebase/server", () => ({
  AdminVotingWindowNotificationStore: class {},
}));
vi.mock("@/lib/notifications/resend", () => ({
  readNotificationSiteUrl: vi.fn(),
  readResendNotificationConfig: vi.fn().mockReturnValue(null),
  ResendVotingWindowNotifier: class {},
}));
vi.mock("@/lib/server/admin-request", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRequestModule>();
  return { ...actual, requireAdminRequest: mocks.requireAdminRequest };
});

import { POST } from "./route";

const action = {
  matchId: "match-manual-route",
  trackedTeamId: "club-sport-herediano",
  externalFixtureId: "fixture-manual-route",
  finalWhistleConfirmed: true as const,
  verificationSource: "https://example.com/final",
  verificationReason: "Acta final revisada por el operador.",
  closeMode: "default" as const,
};

beforeEach(() => {
  mocks.applyAuthorized.mockReset().mockResolvedValue({
    auditId: "manual-audit",
    disposition: "committed",
    plan: {},
  });
  mocks.notify.mockReset().mockResolvedValue("not_configured");
  mocks.requireAdminRequest.mockReset().mockResolvedValue({ uid: "owner-uid" });
});

describe("manual voting apply route", () => {
  it("applies the exact owner-authorized action and starts notification", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.applyAuthorized).toHaveBeenCalledWith(
      { ...action, operatorId: "owner-uid" },
      "b".repeat(43),
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: action.matchId }),
    );
  });

  it("rejects unauthenticated and inexact confirmations before mutation", async () => {
    mocks.requireAdminRequest.mockRejectedValueOnce(
      new AdminAuthorizationError(401),
    );
    expect((await POST(request())).status).toBe(401);
    expect(mocks.applyAuthorized).not.toHaveBeenCalled();

    mocks.requireAdminRequest.mockResolvedValueOnce({ uid: "owner-uid" });
    expect((await POST(request("wrong"))).status).toBe(400);
    expect(mocks.applyAuthorized).not.toHaveBeenCalled();
  });
});

function request(confirmation = `open-voting:${action.matchId}`) {
  const csrf = "a".repeat(43);
  return new NextRequest(
    "http://localhost:3000/api/admin/manual-voting/apply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `rating_admin_manual_voting_action=${"b".repeat(43)}; rating_admin_csrf=${csrf}`,
        Origin: "http://localhost:3000",
        "X-Admin-CSRF": csrf,
      },
      body: JSON.stringify({ action, confirmation }),
    },
  );
}
