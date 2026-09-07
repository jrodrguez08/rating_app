import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/application/run-standings-sync", () => ({
  runConfiguredStandingsSync: mocks.run,
}));
vi.mock("@/lib/firebase/server", () => ({ AdminFootballSyncStore: class {} }));

import { POST } from "./route";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "local");
});

describe("POST /api/internal/standings-sync", () => {
  it("rejects an unauthenticated request", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    expect(
      (await POST(new Request("http://local.test", { method: "POST" }))).status,
    ).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("returns a safe successful result", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    vi.stubEnv("API_FOOTBALL_KEY", "provider-secret");
    mocks.run.mockResolvedValue({
      action: "snapshot_replaced",
      competitionId: "competition-1",
      rows: 10,
      providerRequests: 1,
      logs: ['{"event":"standings.sync_outcome"}'],
    });
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { authorization: "Bearer correct-secret" },
      }),
    );
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(200);
    expect(body).toContain("standings.sync_outcome");
    expect(body).not.toContain("correct-secret");
    expect(body).not.toContain("provider-secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports preservation without leaking provider failures", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    vi.stubEnv("API_FOOTBALL_KEY", "provider-secret");
    mocks.run.mockResolvedValue({
      action: "snapshot_preserved",
      rows: 10,
      providerRequests: 1,
      reason: "malformed-response",
      logs: [],
    });
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { authorization: "Bearer correct-secret" },
      }),
    );
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(503);
    expect(body).toContain("malformed-response");
    expect(body).not.toContain("provider-secret");
  });

  it("fails safely when configuration is missing", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { authorization: "Bearer correct-secret" },
      }),
    );
    expect(response.status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
