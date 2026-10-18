import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";

const mocks = vi.hoisted(() => ({
  assignAuthorized: vi.fn(),
  audit: vi.fn().mockResolvedValue("attempt-audit"),
}));

vi.mock("@/lib/firebase/admin-security", () => ({
  AdminSecurityStore: class {
    audit = mocks.audit;
  },
}));

vi.mock("@/lib/firebase/server", () => {
  class AdminVerifiedCoachAssignmentRejectedError extends Error {}
  class AdminVerifiedCoachAssignmentCommitError extends Error {}
  return {
    AdminVerifiedCoachAssignmentRejectedError,
    AdminVerifiedCoachAssignmentCommitError,
    AdminVerifiedCoachService: class {
      assignAuthorized = mocks.assignAuthorized;
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
  matchId: "match-atomic-route",
  trackedTeamId: "team-route",
  externalFixtureId: "fixture-route",
  coachId: "coach-route",
  coachName: "Coach Route",
  verificationSource: "https://example.com/match-report",
  verificationReason: "Independent fixture-specific match report.",
};

beforeEach(() => {
  mocks.assignAuthorized.mockReset();
  mocks.audit.mockReset();
  mocks.audit.mockResolvedValue("attempt-audit");
});

describe("admin coach assignment apply route", () => {
  it("returns the atomic receipt without a second success audit write", async () => {
    mocks.assignAuthorized.mockResolvedValue({
      plan: { matchId: action.matchId },
      auditId: "atomic-audit",
      disposition: "committed",
    });
    const { POST } = await import("./route");

    const response = await POST(applyRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      applied: true,
      auditId: "atomic-audit",
      disposition: "committed",
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "rating_admin_action=",
    );
  });

  it("audits a known rejection without claiming a transaction failure", async () => {
    const { AdminVerifiedCoachAssignmentRejectedError } =
      await import("@/lib/firebase/server");
    mocks.assignAuthorized.mockRejectedValue(
      new AdminVerifiedCoachAssignmentRejectedError("challenge rejected"),
    );
    const { POST } = await import("./route");

    const response = await POST(applyRequest());

    expect(response.status).toBe(400);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rejected" }),
    );
    expect(response.headers.get("set-cookie")).toContain(
      "rating_admin_action=",
    );
  });

  it("preserves the challenge and writes no failed audit for an indeterminate commit", async () => {
    mocks.assignAuthorized.mockRejectedValue(new Error("connection lost"));
    const { POST } = await import("./route");

    const response = await POST(applyRequest());

    expect(response.status).toBe(400);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("records a proven pre-commit transaction failure", async () => {
    const { AdminVerifiedCoachAssignmentCommitError } =
      await import("@/lib/firebase/server");
    mocks.assignAuthorized.mockRejectedValue(
      new AdminVerifiedCoachAssignmentCommitError(),
    );
    const { POST } = await import("./route");

    const response = await POST(applyRequest());

    expect(response.status).toBe(400);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed" }),
    );
  });
});

function applyRequest() {
  const csrf = "a".repeat(43);
  return new NextRequest(
    "http://localhost:3000/api/admin/coach-assignment/apply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `rating_admin_action=${"b".repeat(43)}; rating_admin_csrf=${csrf}`,
        Origin: "http://localhost:3000",
        "X-Admin-CSRF": csrf,
      },
      body: JSON.stringify({
        action,
        confirmation: `assign-verified-coach:${action.matchId}`,
      }),
    },
  );
}
