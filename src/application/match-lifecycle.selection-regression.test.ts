import { describe, expect, it } from "vitest";

import type { Match } from "@/domain/models";

import { selectRelevantMatch } from "./match-lifecycle";

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: "match-current",
    trackedTeamId: "club-sport-herediano",
    competitionId: "competition-1",
    seasonId: "season-1",
    homeTeam: { externalProviderId: "820", name: "CS Cartaginés" },
    awayTeam: { externalProviderId: "815", name: "CS Herediano" },
    kickoffAt: "2026-08-30T17:00:00.000Z",
    status: "scheduled",
    ratingState: "not_ready",
    score: { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: "1551672",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("post-kickoff relevant match selection", () => {
  it("keeps a scheduled match relevant immediately after kickoff", () => {
    const now = new Date("2026-08-30T17:01:00.000Z");
    const next = match({
      id: "next-match",
      kickoffAt: "2026-09-05T23:00:00.000Z",
      homeTeam: { externalProviderId: "815", name: "CS Herediano" },
      awayTeam: { externalProviderId: "819", name: "Perez Zeledon" },
      externalProviderFixtureId: "next-fixture",
    });

    expect(selectRelevantMatch([match(), next], now)?.id).toBe("match-current");
  });

  it("stops a stale scheduled match from blocking the next fixture after four hours", () => {
    const now = new Date("2026-08-30T21:01:00.000Z");
    const next = match({
      id: "next-match",
      kickoffAt: "2026-09-05T23:00:00.000Z",
      homeTeam: { externalProviderId: "815", name: "CS Herediano" },
      awayTeam: { externalProviderId: "819", name: "Perez Zeledon" },
      externalProviderFixtureId: "next-fixture",
    });

    expect(selectRelevantMatch([match(), next], now)?.id).toBe("next-match");
  });
});
