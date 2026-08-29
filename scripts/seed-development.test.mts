import { describe, expect, it } from "vitest";

import { ensureDevelopmentTeam } from "./seed-development.mjs";

describe("development Team seed safety", () => {
  it("rejects non-local Firestore hosts before making a request", async () => {
    await expect(
      ensureDevelopmentTeam({
        emulatorHost: "firestore.googleapis.com:443",
        projectId: "demo-rating-app-local",
      }),
    ).rejects.toThrow("restricted to a local Firestore emulator");
  });

  it("rejects non-demo project IDs", async () => {
    await expect(
      ensureDevelopmentTeam({
        emulatorHost: "127.0.0.1:8080",
        projectId: "rating-app-production",
      }),
    ).rejects.toThrow("requires a demo-* Firebase project ID");
  });
});
