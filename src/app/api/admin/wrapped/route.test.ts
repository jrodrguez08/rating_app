import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const csrf = "a".repeat(40);
function request(origin: string, csrfHeader: string) {
  return new NextRequest(
    "http://localhost:3000/api/admin/wrapped?club=herediano",
    {
      method: "POST",
      headers: {
        origin,
        "x-admin-csrf": csrfHeader,
        cookie: `rating_admin_csrf=${csrf}`,
      },
      body: "{}",
    },
  );
}

describe("Wrapped owner request boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "local");
    vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "demo-rating-app-local");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-rating-app-local");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
    vi.stubEnv("ADMIN_ALLOWED_ORIGIN", "http://localhost:3000");
    vi.stubEnv("ADMIN_OWNER_UID", "synthetic-owner");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns unavailable before authentication on hosted deployments", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "production");
    const response = await POST(request("https://wrong.example", ""));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("enforces origin, CSRF and a verified owner session even for dry runs", async () => {
    expect((await POST(request("https://wrong.example", csrf))).status).toBe(
      403,
    );
    expect(
      (await POST(request("http://localhost:3000", "b".repeat(40)))).status,
    ).toBe(403);
    expect((await POST(request("http://localhost:3000", csrf))).status).toBe(
      401,
    );
  });

  it("rejects a non-loopback emulator host", async () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "192.0.2.1:8080");
    expect((await POST(request("http://localhost:3000", csrf))).status).toBe(
      404,
    );
  });
});
