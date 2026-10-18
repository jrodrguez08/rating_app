import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  applyAuthorized: vi.fn(),
  audit: vi.fn().mockResolvedValue("attempt-audit"),
}));

vi.mock("@/lib/firebase/admin-security", () => ({
  AdminSecurityStore: class {
    audit = mocks.audit;
  },
}));

vi.mock("@/lib/firebase/admin-lineup", () => {
  class AdminVerifiedLineupRejectedError extends Error {}
  class AdminVerifiedLineupCommitError extends Error {}
  return {
    AdminVerifiedLineupRejectedError,
    AdminVerifiedLineupCommitError,
    AdminVerifiedLineupService: class {
      applyAuthorized = mocks.applyAuthorized;
    },
  };
});

vi.mock("@/lib/server/admin-request", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRequestModule>();
  return {
    ...actual,
    requireAdminRequest: vi.fn().mockResolvedValue({ uid: "owner-uid" }),
  };
});

const action = {
  matchId: "match-lineup-route",
  trackedTeamId: "club-sport-herediano",
  externalFixtureId: "fixture-route",
  participants: Array.from({ length: 12 }, (_, index) => ({
    playerId: `player-${index + 1}`,
    createInternalIdentity: false,
    squadRole: index < 11 ? "starter" : "substitute",
    participationStatus: index < 11 ? "confirmed_starter" : "unused_substitute",
  })),
  verificationSource: "https://example.com/match-report",
  verificationReason: "Independent fixture-specific match report.",
};

beforeEach(() => {
  mocks.applyAuthorized.mockReset();
  mocks.audit.mockReset();
  mocks.audit.mockResolvedValue("attempt-audit");
});

describe("admin verified lineup apply route", () => {
  it("passes the authenticated owner and challenge to the atomic service", async () => {
    mocks.applyAuthorized.mockResolvedValue({
      plan: { matchId: action.matchId },
      auditId: "atomic-audit",
      disposition: "committed",
    });
    const response = await POST(applyRequest());

    expect(response.status).toBe(200);
    expect(mocks.applyAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({ ...action, operatorId: "owner-uid" }),
      "b".repeat(43),
    );
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "rating_admin_lineup_action=",
    );
  });

  it("rejects an inexact fixture confirmation before applying", async () => {
    const request = applyRequest("wrong-confirmation");

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mocks.applyAuthorized).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed" }),
    );
  });
});

function applyRequest(
  confirmation = `prepare-verified-lineup:${action.matchId}`,
) {
  const csrf = "a".repeat(43);
  return new NextRequest("http://localhost:3000/api/admin/lineup/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `rating_admin_lineup_action=${"b".repeat(43)}; rating_admin_csrf=${csrf}`,
      Origin: "http://localhost:3000",
      "X-Admin-CSRF": csrf,
    },
    body: JSON.stringify({ action, confirmation }),
  });
}
