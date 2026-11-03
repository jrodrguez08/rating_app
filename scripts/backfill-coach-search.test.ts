import { describe, expect, it } from "vitest";

import { parseCoachBackfillArguments } from "./backfill-coach-search";

describe("coach search backfill guard", () => {
  it("defaults to a read-only dry run for an exact non-demo project", () => {
    expect(
      parseCoachBackfillArguments(["--project-id", "rating-production"]),
    ).toEqual({ projectId: "rating-production", apply: false });
  });

  it("requires a project-bound confirmation before apply", () => {
    expect(() =>
      parseCoachBackfillArguments([
        "--project-id",
        "rating-production",
        "--apply",
        "true",
      ]),
    ).toThrow();
    expect(
      parseCoachBackfillArguments([
        "--project-id",
        "rating-production",
        "--apply",
        "true",
        "--confirm",
        "backfill-coach-search:rating-production",
      ]),
    ).toEqual({ projectId: "rating-production", apply: true });
    expect(() =>
      parseCoachBackfillArguments(["--project-id", "demo-local"]),
    ).toThrow();
  });
});
