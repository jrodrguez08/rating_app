import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/application/run-lifecycle", () => ({
  runConfiguredLifecycle: mocks.run,
}));
vi.mock("@/lib/firebase/server", () => ({
  AdminFootballSyncStore: class {},
}));

import { POST } from "./route";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "local");
  mocks.run.mockResolvedValue({ action: "idle", providerRequests: 0 });
});

describe("POST /api/internal/match-lifecycle", () => {
  it("rejects missing and incorrect secrets", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    expect(
      (await POST(new Request("http://local.test", { method: "POST" }))).status,
    ).toBe(401);
    expect(
      (
        await POST(
          new Request("http://local.test", {
            method: "POST",
            headers: { authorization: "Bearer wrong" },
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("accepts the configured secret and returns no credential material", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    vi.stubEnv("API_FOOTBALL_KEY", "provider-secret");
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { authorization: "Bearer correct-secret" },
      }),
    );
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(body).not.toContain("correct-secret");
    expect(body).not.toContain("provider-secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns the safe readiness reason while preparing rating", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    vi.stubEnv("API_FOOTBALL_KEY", "provider-secret");
    mocks.run.mockResolvedValue({
      action: "preparing_rating",
      matchId: "match-1",
      providerRequests: 2,
      reason: "Readiness incomplete: 10 rateable participants; head coach present.",
    });
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { authorization: "Bearer correct-secret" },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      action: "preparing_rating",
      matchId: "match-1",
      providerRequests: 2,
      reason: "Readiness incomplete: 10 rateable participants; head coach present.",
    });
  });

  it("fails safely when the API key is missing", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { authorization: "Bearer correct-secret" },
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Lifecycle synchronization is not configured.",
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("does not return provider failure details or secrets", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    vi.stubEnv("API_FOOTBALL_KEY", "provider-secret");
    mocks.run.mockResolvedValue({
      action: "retryable_error",
      matchId: "match-1",
      providerRequests: 1,
      reason: "provider-secret remote response body",
    });
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { authorization: "Bearer correct-secret" },
      }),
    );
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(503);
    expect(body).toContain("match-1");
    expect(body).not.toContain("provider-secret");
    expect(body).not.toContain("response body");
  });
});
