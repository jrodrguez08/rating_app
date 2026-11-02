import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("daily standings workflow", () => {
  it("runs separately at 03:00 Costa Rica time and targets only standings", async () => {
    const workflow = await readFile(
      ".github/workflows/standings-sync.yml",
      "utf8",
    );
    expect(workflow).toContain('cron: "0 9 * * *"');
    expect(workflow).toContain("03:00 America/Costa_Rica");
    expect(workflow).toContain("STANDINGS_SYNC_URL");
    expect(workflow).toContain("SAPRISSA_STANDINGS_SYNC_URL");
    expect(workflow).toContain("needs: trigger");
    expect(workflow).toContain(
      "always() && vars.SAPRISSA_SCHEDULED_ENABLED == 'true'",
    );
    expect(workflow).toContain("?club=saprissa");
    expect(workflow).not.toContain("LIFECYCLE_SYNC_URL");
  });

  it("keeps Herediano's lifecycle trigger and adds an independently guarded Saprissa job", async () => {
    const workflow = await readFile(
      ".github/workflows/match-lifecycle.yml",
      "utf8",
    );
    expect(workflow).toContain("secrets.LIFECYCLE_SYNC_URL");
    expect(workflow).toContain("secrets.SAPRISSA_LIFECYCLE_SYNC_URL");
    expect(workflow).toContain(
      "always() && vars.SAPRISSA_SCHEDULED_ENABLED == 'true'",
    );
    expect(workflow).toContain("?club=saprissa");
  });
});
