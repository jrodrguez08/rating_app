import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  doc: vi.fn(),
  get: vi.fn(),
  getServerFirestore: vi.fn(),
}));
vi.mock("@/lib/firebase/server", () => ({
  getServerFirestore: mocks.getServerFirestore,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "local");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("API_FOOTBALL_KEY", "provider-key");
  mocks.get.mockResolvedValue({ exists: true });
  mocks.doc.mockReturnValue({ get: mocks.get });
  mocks.getServerFirestore.mockReturnValue({ doc: mocks.doc });
});

describe("GET /api/internal/health", () => {
  it("fails closed without the scheduler credential", async () => {
    const response = await GET(new Request("http://local/health"));
    expect(response.status).toBe(401);
    expect(mocks.getServerFirestore).not.toHaveBeenCalled();
  });

  it("fails closed with the wrong scheduler credential", async () => {
    const response = await GET(
      new Request("http://local/health", {
        headers: { Authorization: "Bearer wrong-secret" },
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ status: "unauthorized" });
    expect(mocks.getServerFirestore).not.toHaveBeenCalled();
  });

  it("reports only a safe ready state", async () => {
    const response = await GET(
      new Request("http://local/health", {
        headers: { Authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      clubs: { herediano: "ready", saprissa: "disabled" },
      public: { herediano: true, saprissa: false },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports a safe configuration failure", async () => {
    vi.stubEnv("API_FOOTBALL_KEY", "");
    const response = await GET(
      new Request("http://local/health", {
        headers: { Authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      reason: "configuration",
    });
    expect(mocks.getServerFirestore).not.toHaveBeenCalled();
  });

  it("reports a safe Firebase Admin failure without leaking the error", async () => {
    mocks.get.mockRejectedValue(new Error("secret credential content"));
    const response = await authorizedRequest();
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).toBe('{"status":"not_ready","reason":"firebase_admin"}');
    expect(body).not.toContain("credential");
    expect(body).not.toContain("secret");
  });

  it("reports when the canonical Team is missing", async () => {
    mocks.get.mockResolvedValue({ exists: false });
    const response = await authorizedRequest();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      reason: "team_missing",
    });
  });

  it("distinguishes a bootstrapped idle club, awaiting evidence, and a failed execution", async () => {
    vi.stubEnv("SAPRISSA_SCHEDULED_ENABLED", "true");
    const values: Record<string, { exists: boolean; data: () => object }> = {
      "teams/club-sport-herediano": { exists: true, data: () => ({}) },
      "teams/deportivo-saprissa": {
        exists: true,
        data: () => ({ externalProviderId: "816" }),
      },
      "footballSyncMetadata/deportivo-saprissa": {
        exists: false,
        data: () => ({}),
      },
    };
    mocks.doc.mockImplementation((path: string) => ({
      get: async () => values[path] ?? { exists: false, data: () => ({}) },
    }));
    await expect((await authorizedRequest()).json()).resolves.toMatchObject({
      status: "ready",
      clubs: { herediano: "ready", saprissa: "no_relevant_fixture" },
    });
    values["footballSyncMetadata/deportivo-saprissa"] = {
      exists: true,
      data: () => ({
        lastLifecycleAction: "preparing_rating",
        lastLifecycleMatchId: "match-s",
      }),
    };
    values["matches/match-s"] = {
      exists: true,
      data: () => ({
        trackedTeamId: "deportivo-saprissa",
        ratingState: "preparing_rating",
      }),
    };
    await expect((await authorizedRequest()).json()).resolves.toMatchObject({
      clubs: { saprissa: "awaiting_evidence" },
    });
    values["footballSyncMetadata/deportivo-saprissa"] = {
      exists: true,
      data: () => ({ lastLifecycleAction: "retryable_error" }),
    };
    const failed = await authorizedRequest();
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({
      status: "not_ready",
      clubs: { herediano: "ready", saprissa: "operational_failure" },
    });
  });

  it("fails malformed scheduled enablement closed", async () => {
    vi.stubEnv("SAPRISSA_SCHEDULED_ENABLED", "yes");
    const response = await authorizedRequest();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      clubs: { saprissa: "invalid_configuration" },
    });
  });
});

function authorizedRequest() {
  return GET(
    new Request("http://local/health", {
      headers: { Authorization: "Bearer cron-secret" },
    }),
  );
}
