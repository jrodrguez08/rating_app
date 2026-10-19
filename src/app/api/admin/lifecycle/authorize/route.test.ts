import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  authorizeAction: vi.fn(),
  requireAdminRequest: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-security", () => ({
  AdminSecurityError: class extends Error {},
  AdminSecurityStore: class {
    audit = mocks.audit;
    authorizeAction = mocks.authorizeAction;
  },
}));

vi.mock("@/lib/server/admin-request", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRequestModule>();
  return { ...actual, requireAdminRequest: mocks.requireAdminRequest };
});

import { POST } from "./route";

const originalEnvironment = { ...process.env };
const passphrase = "independent plaintext secret";
const action = {
  matchId: "match-lifecycle-authorize",
  trackedTeamId: "club-sport-herediano",
  externalFixtureId: "fixture-lifecycle-authorize",
};

beforeEach(() => {
  process.env.ADMIN_OWNER_UID = "owner-uid";
  process.env.ADMIN_ALLOWED_ORIGIN = "http://localhost:3000";
  process.env.NEXT_PUBLIC_FIREBASE_ENVIRONMENT = "local";
  vi.clearAllMocks();
  mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
  mocks.authorizeAction.mockResolvedValue({
    token: "challenge-token",
    expiresAt: "2026-10-19T14:02:00.000Z",
  });
  mocks.audit.mockResolvedValue("audit-id");
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("admin lifecycle authorization route", () => {
  it("verifies plaintext server-side without echoing or auditing it", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/lifecycle/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          previewToken: "preview-token",
          passphrase,
        }),
      }),
    );
    const bodyText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(bodyText).not.toContain(passphrase);
    expect(mocks.authorizeAction).toHaveBeenCalledWith({
      operatorUid: "owner-uid",
      action,
      previewToken: "preview-token",
      passphrase,
    });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(passphrase);
  });
});
