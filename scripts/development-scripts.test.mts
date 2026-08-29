import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("local development scripts", () => {
  it("supervises the web app and Firebase emulators from the default command", () => {
    expect(packageJson.scripts.dev).toContain("concurrently --kill-others");
    expect(packageJson.scripts.dev).toContain("npm:dev:web");
    expect(packageJson.scripts.dev).toContain("npm:firebase:emulators");
    expect(packageJson.devDependencies.concurrently).toMatch(/^\^10\./);
  });

  it("preserves focused web and emulator commands", () => {
    expect(packageJson.scripts["dev:web"]).toBe("next dev");
    expect(packageJson.scripts["firebase:emulators"]).toBe(
      "firebase emulators:start --only auth,firestore",
    );
  });
});
