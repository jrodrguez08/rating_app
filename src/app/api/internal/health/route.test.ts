import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTeam: vi.fn() }));
vi.mock("@/lib/firebase/server", () => ({
  AdminFootballSyncStore: class {
    getTeam = mocks.getTeam;
  },
}));

import { GET } from "./route";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "local");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("API_FOOTBALL_KEY", "provider-key");
  mocks.getTeam.mockResolvedValue({ id: "club-sport-herediano" });
});

describe("GET /api/internal/health", () => {
  it("fails closed without the scheduler credential", async () => {
    const response = await GET(new Request("http://local/health"));
    expect(response.status).toBe(401);
    expect(mocks.getTeam).not.toHaveBeenCalled();
  });

  it("reports only a safe ready state", async () => {
    const response = await GET(
      new Request("http://local/health", {
        headers: { Authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a sanitized not-ready response for configuration or Firestore failures", async () => {
    mocks.getTeam.mockRejectedValue(new Error("secret credential content"));
    const response = await GET(
      new Request("http://local/health", {
        headers: { Authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).toBe('{"status":"not_ready"}');
    expect(body).not.toContain("credential");
  });
});
