import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";

const mocks = vi.hoisted(() => ({ assign: vi.fn(), issuePreview: vi.fn() }));
vi.mock("@/lib/firebase/admin-security", () => ({
  AdminSecurityStore: class {
    issuePreview = mocks.issuePreview;
  },
}));
vi.mock("@/lib/firebase/server", () => ({
  AdminVerifiedCoachService: class {
    assign = mocks.assign;
  },
}));
vi.mock("@/lib/server/admin-request", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRequestModule>();
  return {
    ...actual,
    requireAdminRequest: vi.fn().mockResolvedValue({ uid: "owner" }),
  };
});

describe("canonical Coach assignment preview", () => {
  it("signs and returns the server-resolved identity version with the exact selected action", async () => {
    const action = {
      matchId: "match",
      trackedTeamId: "club-sport-herediano",
      externalFixtureId: "fixture",
      coachId: "canonical-manual",
      coachName: "Synthetic Coach",
      externalProviderCoachId: "42",
      verificationSource: "authenticated-owner",
      verificationReason: "Independent fixture verification.",
    };
    const coachIdentityVersion = "a".repeat(64);
    mocks.assign.mockResolvedValue({
      coachIdentityVersion,
      coachId: action.coachId,
    });
    mocks.issuePreview.mockResolvedValue({
      token: "preview",
      expiresAt: "2040-01-01",
    });
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "https://rating.test/api/admin/coach-assignment/preview?club=herediano",
        { method: "POST", body: JSON.stringify(action) },
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.issuePreview).toHaveBeenCalledWith("owner", {
      ...action,
      coachIdentityVersion,
    });
    expect(await response.json()).toMatchObject({
      action: { ...action, coachIdentityVersion },
      previewToken: "preview",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
