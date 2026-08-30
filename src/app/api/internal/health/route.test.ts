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
    await expect(response.json()).resolves.toEqual({ status: "ready" });
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
});

function authorizedRequest() {
  return GET(
    new Request("http://local/health", {
      headers: { Authorization: "Bearer cron-secret" },
    }),
  );
}
