import { describe, expect, it } from "vitest";
import type { Query } from "firebase-admin/firestore";

import {
  parseMembershipBackfillArguments,
  readAllQueryPages,
} from "./backfill-team-player-memberships";

describe("team player membership backfill arguments", () => {
  it("defaults to a bounded dry run", () => {
    expect(
      parseMembershipBackfillArguments(["--project-id", "rating-production"]),
    ).toEqual({
      projectId: "rating-production",
      teamId: "club-sport-herediano",
      apply: false,
    });
  });

  it("requires the Team-bound confirmation for writes", () => {
    expect(() =>
      parseMembershipBackfillArguments([
        "--project-id",
        "rating-production",
        "--apply",
        "true",
      ]),
    ).toThrow(/Usage/);
    expect(
      parseMembershipBackfillArguments([
        "--project-id",
        "rating-production",
        "--team-id",
        "team-1",
        "--apply",
        "true",
        "--confirm",
        "backfill-team-player-memberships:team-1",
      ]),
    ).toEqual({
      projectId: "rating-production",
      teamId: "team-1",
      apply: true,
    });
  });

  it("rejects demo projects", () => {
    expect(() =>
      parseMembershipBackfillArguments(["--project-id", "demo-local"]),
    ).toThrow(/rejects demo/i);
  });
});

describe("team player membership pagination", () => {
  it("reports the collection and page when a read fails", async () => {
    const failingQuery = {
      orderBy() {
        return this;
      },
      limit() {
        return this;
      },
      async get() {
        throw new Error("simulated outage");
      },
    } as unknown as Query;

    await expect(
      readAllQueryPages(failingQuery, "tracked Team matches", 20, () => {}),
    ).rejects.toThrow(
      "Failed to read tracked Team matches page 1: simulated outage",
    );
  });
});
