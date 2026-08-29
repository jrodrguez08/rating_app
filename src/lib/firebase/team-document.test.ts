import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { Team } from "@/domain/models";

import { teamFromDocument, teamToDocument } from "./team-document";

const team: Team = {
  id: "test-team",
  displayName: "Test Football Club",
  shortName: "Test FC",
  countryName: "Costa Rica",
  countryCode: "CR",
  brandingKey: "test-fc",
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-02-03T04:05:06.000Z",
};

describe("Team Firestore conversion", () => {
  it("round-trips a Team without leaking Firestore timestamps", () => {
    expect(teamFromDocument(team.id, teamToDocument(team))).toEqual(team);
  });

  it("preserves an optional external provider ID", () => {
    const mapped = { ...team, externalProviderId: "provider-42" };
    expect(teamFromDocument(mapped.id, teamToDocument(mapped))).toEqual(mapped);
  });

  it("fails clearly for malformed persisted data", () => {
    expect(() =>
      teamFromDocument("broken", {
        displayName: "Broken FC",
        shortName: "Broken",
        countryName: "Costa Rica",
        countryCode: "CR",
        brandingKey: "broken",
        createdAt: "not-a-timestamp",
        updatedAt: Timestamp.now(),
      }),
    ).toThrow("createdAt must be a Timestamp");
  });
});
