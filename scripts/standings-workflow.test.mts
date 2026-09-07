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
    expect(workflow).not.toContain("LIFECYCLE_SYNC_URL");
  });
});
