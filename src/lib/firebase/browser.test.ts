import { beforeEach, describe, expect, it, vi } from "vitest";

const firebaseApp = { name: "test-app" };
const auth = { name: "auth" };
const connectAuthEmulator = vi.fn();
const getAuth = vi.fn(() => auth);
const initializeApp = vi.fn(() => firebaseApp);

vi.mock("firebase/app", () => ({
  getApp: vi.fn(() => firebaseApp),
  getApps: vi.fn(() => []),
  initializeApp,
}));
vi.mock("firebase/auth", () => ({ connectAuthEmulator, getAuth }));
vi.mock("firebase/firestore", () => ({
  connectFirestoreEmulator: vi.fn(),
  getFirestore: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  const globals = globalThis as typeof globalThis & {
    __ratingAppAuthEmulators?: Set<string>;
  };
  globals.__ratingAppAuthEmulators?.clear();
});

describe("browser Firebase Auth", () => {
  it("connects local Auth to the configured emulator only once", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "local");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_AUTH_EMULATOR_HOST", "localhost");
    vi.stubEnv("NEXT_PUBLIC_AUTH_EMULATOR_PORT", "9099");
    const { getBrowserAuth } = await import("./browser");

    expect(getBrowserAuth()).toBe(auth);
    expect(getBrowserAuth()).toBe(auth);
    expect(connectAuthEmulator).toHaveBeenCalledOnce();
    expect(connectAuthEmulator).toHaveBeenCalledWith(
      auth,
      "http://localhost:9099",
      { disableWarnings: true },
    );
    expect(initializeApp).toHaveBeenCalledWith({
      apiKey: "demo-api-key",
      authDomain: "demo-rating-app-local.firebaseapp.com",
      projectId: "demo-rating-app-local",
    });
  });

  it("does not connect development Auth to an emulator", async () => {
    stubCompleteDevelopmentConfig();
    const { getBrowserAuth } = await import("./browser");

    expect(getBrowserAuth()).toBe(auth);
    expect(connectAuthEmulator).not.toHaveBeenCalled();
  });

  it("rejects malformed development configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "development");
    const { getBrowserAuth } = await import("./browser");

    expect(() => getBrowserAuth()).toThrow(
      "Firebase environment configuration is missing or invalid",
    );
    expect(getAuth).not.toHaveBeenCalled();
  });
});

function stubCompleteDevelopmentConfig() {
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "development");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "public-api-key");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "example.test");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "rating-app-development");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "example.test");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "sender");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "app");
}
