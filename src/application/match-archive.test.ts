import { describe, expect, it } from "vitest";

import type { Match } from "@/domain/models";

import { buildMatchArchive, type MatchArchiveItem } from "./match-archive";

const now = new Date("2026-08-31T12:00:00.000Z");

describe("match archive", () => {
  it("selects the relevant match and orders the remaining archive without duplicating the feature", () => {
    const items = [
      item(
        match({
          id: "old",
          kickoffAt: "2026-08-20T18:00:00.000Z",
          status: "finished",
        }),
      ),
      item(
        match({
          id: "recent",
          kickoffAt: "2026-08-30T18:00:00.000Z",
          status: "finished",
        }),
      ),
      item(match({ id: "later", kickoffAt: "2026-09-10T18:00:00.000Z" })),
      item(match({ id: "next", kickoffAt: "2026-09-03T18:00:00.000Z" })),
    ];

    const archive = buildMatchArchive(items, now);

    expect(archive.recent.map(({ match }) => match.id)).toEqual([
      "recent",
      "old",
    ]);
    expect(archive.upcoming.map(({ match }) => match.id)).toEqual(["later"]);
    expect(archive.relevant?.match.id).toBe("next");
  });
});

function item(value: Match): MatchArchiveItem {
  return { match: value, hasResults: false };
}

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: "match",
    trackedTeamId: "team",
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "CS Herediano" },
    awayTeam: { externalProviderId: "820", name: "CS Cartaginés" },
    kickoffAt: "2026-09-01T18:00:00.000Z",
    status: "scheduled",
    ratingState: "not_ready",
    score: { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: "1",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}
