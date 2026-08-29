import { describe, expect, it, vi } from "vitest";

vi.mock("@/application/run-lifecycle", () => ({
  runConfiguredLifecycle: vi.fn().mockResolvedValue({
    action: "idle",
    providerRequests: 0,
  }),
}));
vi.mock("@/lib/firebase/server", () => ({
  AdminFootballSyncStore: class {},
}));

import { POST } from "./route";

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
  });
});
