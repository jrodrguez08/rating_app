import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({ name: "rating-admin" })),
  getAuth: vi.fn(() => ({ name: "admin-auth" })),
  setPersistence: vi.fn().mockResolvedValue(undefined),
  connectAuthEmulator: vi.fn(),
}));

vi.mock("firebase/app", () => ({
  getApp: vi.fn(),
  getApps: vi.fn(() => [{ name: "[DEFAULT]" }]),
  initializeApp: mocks.initializeApp,
}));
vi.mock("firebase/auth", () => ({
  connectAuthEmulator: mocks.connectAuthEmulator,
  getAuth: mocks.getAuth,
  inMemoryPersistence: { type: "NONE" },
  setPersistence: mocks.setPersistence,
}));
vi.mock("./config", () => ({
  authEmulator: { host: "127.0.0.1", port: 9099 },
  firebaseEnvironment: {
    apiKey: "demo",
    authDomain: "demo",
    projectId: "demo-rating-app-local",
  },
  firebaseEnvironmentName: "local",
  isFirebaseConfigured: true,
  isFirebaseEnvironmentSafe: true,
}));

describe("admin browser authentication isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a named in-memory Auth app without replacing the default supporter app", async () => {
    const { getAdminBrowserAuth } = await import("./admin-browser");
    await expect(getAdminBrowserAuth()).resolves.toEqual({
      name: "admin-auth",
    });
    expect(mocks.initializeApp).toHaveBeenCalledWith(
      expect.any(Object),
      "rating-admin",
    );
    expect(mocks.getAuth).toHaveBeenCalledWith({ name: "rating-admin" });
    expect(mocks.setPersistence).toHaveBeenCalledWith(
      { name: "admin-auth" },
      { type: "NONE" },
    );
  });
});
