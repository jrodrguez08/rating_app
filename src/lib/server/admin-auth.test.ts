import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { describe, expect, it, vi } from "vitest";

import {
  authenticateAdminIdToken,
  requireAdminCsrf,
  requireAdminOrigin,
  verifyAdminSession,
} from "./admin-auth";

const environment = {
  ADMIN_OWNER_UID: "owner-uid-123",
  ADMIN_ALLOWED_ORIGIN: "https://ratings.example",
  NEXT_PUBLIC_FIREBASE_ENVIRONMENT: "production",
};

function token(values: Partial<DecodedIdToken> = {}): DecodedIdToken {
  return {
    uid: "owner-uid-123",
    aud: "project",
    auth_time: 1,
    exp: 2,
    firebase: { identities: {}, sign_in_provider: "password" },
    iat: 1,
    iss: "issuer",
    sub: "owner-uid-123",
    email_verified: true,
    ...values,
  };
}

describe("admin authorization", () => {
  it("accepts only the exact verified password owner", async () => {
    const verifyIdToken = vi.fn().mockResolvedValue(token());
    const auth = {
      verifyIdToken,
      verifySessionCookie: vi.fn().mockResolvedValue(token()),
    } as unknown as Auth;
    await expect(
      authenticateAdminIdToken("token", auth, environment),
    ).resolves.toEqual({ uid: "owner-uid-123" });
    await expect(
      verifyAdminSession("session", auth, environment),
    ).resolves.toEqual({ uid: "owner-uid-123" });
    for (const rejected of [
      token({ uid: "different-owner" }),
      token({ email_verified: false }),
      token({ firebase: { identities: {}, sign_in_provider: "anonymous" } }),
    ]) {
      verifyIdToken.mockResolvedValueOnce(rejected);
      await expect(
        authenticateAdminIdToken("token", auth, environment),
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  it("rejects forged or revoked credentials", async () => {
    const auth = {
      verifyIdToken: vi.fn().mockRejectedValue(new Error("revoked")),
      verifySessionCookie: vi.fn().mockRejectedValue(new Error("forged")),
    } as unknown as Auth;
    await expect(
      authenticateAdminIdToken("token", auth, environment),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      verifyAdminSession("session", auth, environment),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("enforces exact origin and double-submit CSRF", () => {
    expect(() =>
      requireAdminOrigin("https://ratings.example", environment),
    ).not.toThrow();
    expect(() =>
      requireAdminOrigin("https://evil.example", environment),
    ).toThrow();
    const csrf = "a".repeat(43);
    expect(() => requireAdminCsrf(csrf, csrf)).not.toThrow();
    expect(() => requireAdminCsrf(csrf, "b".repeat(43))).toThrow();
  });

  it("fails closed when the owner UID is missing", async () => {
    const auth = { verifySessionCookie: vi.fn() } as unknown as Auth;
    await expect(
      verifyAdminSession("session", auth, {
        ADMIN_ALLOWED_ORIGIN: "https://ratings.example",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(auth.verifySessionCookie).not.toHaveBeenCalled();
  });
});
