import { describe, expect, it } from "vitest";

import { readFirebaseAdminRuntimeConfig } from "./environment";

const hosted = {
  NEXT_PUBLIC_FIREBASE_ENVIRONMENT: "production",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "rating-app-production",
  FIREBASE_ADMIN_PROJECT_ID: "rating-app-production",
  FIREBASE_ADMIN_CLIENT_EMAIL: "admin@example.test",
  FIREBASE_ADMIN_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\\nplaceholder\\n-----END PRIVATE KEY-----\\n",
};

describe("server Firebase environment validation", () => {
  it("derives safe local Admin emulator configuration", () => {
    expect(
      readFirebaseAdminRuntimeConfig({
        NEXT_PUBLIC_FIREBASE_ENVIRONMENT: "local",
      }),
    ).toEqual({
      environment: "local",
      projectId: "demo-rating-app-local",
      emulator: true,
      firestoreEmulatorHost: "127.0.0.1:8080",
      authEmulatorHost: "127.0.0.1:9099",
    });
  });

  it("rejects non-demo local projects", () => {
    expect(() =>
      readFirebaseAdminRuntimeConfig({
        NEXT_PUBLIC_FIREBASE_ENVIRONMENT: "local",
        FIREBASE_ADMIN_PROJECT_ID: "rating-app-production",
      }),
    ).toThrow("demo-*");
    expect(() =>
      readFirebaseAdminRuntimeConfig({
        NEXT_PUBLIC_FIREBASE_ENVIRONMENT: "local",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "rating-app-development",
      }),
    ).toThrow("demo-*");
  });

  it("rejects demo projects and emulator hosts in production", () => {
    expect(() =>
      readFirebaseAdminRuntimeConfig({
        ...hosted,
        FIREBASE_ADMIN_PROJECT_ID: "demo-production",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-production",
      }),
    ).toThrow("demo-*");
    expect(() =>
      readFirebaseAdminRuntimeConfig({
        ...hosted,
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toThrow("must not use emulator");
  });

  it("requires matching Web/Admin projects and well-formed credentials", () => {
    expect(() =>
      readFirebaseAdminRuntimeConfig({
        NEXT_PUBLIC_FIREBASE_ENVIRONMENT: "production",
      }),
    ).toThrow("FIREBASE_ADMIN_PROJECT_ID is required");
    expect(() =>
      readFirebaseAdminRuntimeConfig({
        ...hosted,
        FIREBASE_ADMIN_PROJECT_ID: "another-project",
      }),
    ).toThrow("must match");
    expect(() =>
      readFirebaseAdminRuntimeConfig({
        ...hosted,
        FIREBASE_ADMIN_PRIVATE_KEY: "not-a-key",
      }),
    ).toThrow("malformed");
  });

  it("accepts complete hosted configuration and expands key newlines", () => {
    const result = readFirebaseAdminRuntimeConfig(hosted);
    expect(result).toMatchObject({
      environment: "production",
      projectId: "rating-app-production",
      emulator: false,
      clientEmail: "admin@example.test",
    });
    expect(result.privateKey).toContain("\nplaceholder\n");
  });
});
