import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSessionCookie: vi.fn().mockResolvedValue("server-session"),
  verifyIdToken: vi.fn().mockResolvedValue({
    uid: "owner-uid-123",
    email_verified: true,
    firebase: { sign_in_provider: "password" },
  }),
  verifySessionCookie: vi.fn().mockResolvedValue({
    uid: "owner-uid-123",
    email_verified: true,
    firebase: { sign_in_provider: "password" },
  }),
  revokeRefreshTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/firebase/server", () => ({
  getServerAuth: () => mocks,
}));

const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env.ADMIN_OWNER_UID = "owner-uid-123";
  process.env.ADMIN_ALLOWED_ORIGIN = "http://localhost:3000";
  process.env.NEXT_PUBLIC_FIREBASE_ENVIRONMENT = "local";
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("admin session routes", () => {
  it("issues a short HttpOnly session and a strict CSRF cookie", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ idToken: "firebase-id-token" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("firebase-id-token", true);
    expect(mocks.createSessionCookie).toHaveBeenCalledWith(
      "firebase-id-token",
      { expiresIn: 3_600_000 },
    );
    const cookies = response.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("rating_admin_session=server-session");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=strict");
    expect(cookies).toContain("rating_admin_csrf=");
  });

  it("revokes the owner session on CSRF-protected logout", async () => {
    const { POST } = await import("./logout/route");
    const csrf = "a".repeat(43);
    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/session/logout", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "X-Admin-CSRF": csrf,
          Cookie: `rating_admin_session=server-session; rating_admin_csrf=${csrf}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.verifySessionCookie).toHaveBeenCalledWith(
      "server-session",
      true,
    );
    expect(mocks.revokeRefreshTokens).toHaveBeenCalledWith("owner-uid-123");
    expect(response.headers.get("set-cookie")).toContain(
      "rating_admin_session=",
    );
  });

  it("rejects a cross-origin login before token verification", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://evil.test",
        },
        body: JSON.stringify({ idToken: "firebase-id-token" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
