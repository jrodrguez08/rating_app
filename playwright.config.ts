import { scryptSync } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const projectId = "demo-rating-app-e2e";
const passphrase = "e2e-owner-confirmation-2026";
const salt = Buffer.alloc(16, 7);
const digest = scryptSync(passphrase, salt, 32, {
  N: 16_384,
  r: 8,
  p: 1,
});
const passphraseVerifier = `scrypt$v1$16384$8$1$${salt.toString("base64")}$${digest.toString("base64")}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/e2e/seed.ts",
  use: { ...devices["Desktop Chrome"], baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:web -- --hostname 127.0.0.1 --port 3100",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_FIREBASE_ENVIRONMENT: "local",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
      FIREBASE_ADMIN_PROJECT_ID: projectId,
      NEXT_PUBLIC_SITE_URL: "https://rating-app.test",
      SAPRISSA_PUBLIC_ENABLED: "true",
      ADMIN_OWNER_UID: "e2e-owner",
      ADMIN_ALLOWED_ORIGIN: baseURL,
      ADMIN_PASSPHRASE_SCRYPT: passphraseVerifier,
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    },
  },
});
