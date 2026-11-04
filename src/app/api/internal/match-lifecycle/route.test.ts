import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/application/run-lifecycle", () => ({
  runConfiguredLifecycle: mocks.run,
}));
vi.mock("@/lib/firebase/server", () => ({
  AdminFootballSyncStore: class {},
  AdminVotingWindowNotificationStore: class {},
}));

import { POST } from "./route";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "local");
  mocks.run.mockResolvedValue({ action: "idle", providerRequests: 0 });
});

describe("POST /api/internal/match-lifecycle", () => {
  it("keeps Saprissa disabled before provider configuration and runs only when enabled", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    const request = () =>
      new Request("http://local.test?club=saprissa", {
        method: "POST",
        headers: { authorization: "Bearer correct-secret" },
      });
    const disabled = await POST(request());
    await expect(disabled.json()).resolves.toEqual({
      action: "disabled",
      club: "saprissa",
      providerRequests: 0,
    });
    expect(mocks.run).not.toHaveBeenCalled();
    vi.stubEnv("SAPRISSA_SCHEDULED_ENABLED", "true");
    vi.stubEnv("API_FOOTBALL_KEY", "provider-secret");
    await POST(request());
    expect(mocks.run).toHaveBeenCalledWith(
      "deportivo-saprissa",
      expect.anything(),
      "provider-secret",
      undefined,
      expect.anything(),
    );
  });

  it("rejects malformed or unknown targets before any provider work", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    for (const query of [
      "club=unknown",
      "club=saprissa&club=herediano",
      "team=816",
    ]) {
      const response = await POST(
        new Request(`http://local.test?${query}`, {
          method: "POST",
          headers: { authorization: "Bearer correct-secret" },
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.run).not.toHaveBeenCalled();
  });
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
    mocks.run.mockResolvedValue({
      action: "idle",
      providerRequests: 0,
      logs: [
        '{"event":"lifecycle.outcome","action":"idle","providerRequests":0}',
      ],
    });
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
    expect(body).toContain("lifecycle.outcome");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns the safe readiness reason while preparing rating", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    vi.stubEnv("API_FOOTBALL_KEY", "provider-secret");
    mocks.run.mockResolvedValue({
      action: "preparing_rating",
      matchId: "match-1",
      providerRequests: 2,
      reason:
        "Readiness incomplete: 10 rateable participants; head coach present.",
    });
    const response = await POST(
      new Request("http://local.test", {
        method: "POST",
        headers: { authorization: "Bearer correct-secret" },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      action: "preparing_rating",
      club: "herediano",
      matchId: "match-1",
      providerRequests: 2,
      reason:
        "Readiness incomplete: 10 rateable participants; head coach present.",
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
