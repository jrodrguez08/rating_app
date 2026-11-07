import { describe, expect, it } from "vitest";

import { confirmedManualScore } from "@/domain/final-score";
import type { ProviderFixture } from "@/domain/ports";

import { wrappedMatch } from "../../tests/wrapped-fixtures";

const match = wrappedMatch("herediano", "123");
const fixture: ProviderFixture = {
  ...match,
  externalFixtureId: "123",
  externalCompetitionId: "1",
  providerSeason: 2025,
};

describe("manual score evidence", () => {
  it.each([
    [0, 0],
    [1, 0],
    [0, 2],
  ])("accepts %i–%i", (home, away) => {
    expect(
      confirmedManualScore(match, "api-football", {
        ...fixture,
        score: { home, away },
      }),
    ).toEqual({ home, away });
  });
  it.each([
    { home: null, away: 1 },
    { home: 1, away: null },
    { home: -1, away: 0 },
    { home: 0, away: 0.5 },
  ])("rejects %o", (score) => {
    expect(
      confirmedManualScore(match, "api-football", { ...fixture, score }),
    ).toBeNull();
  });
  it("rejects missing fields, nonfinal statuses, different providers and reversed or mismatched fixtures", () => {
    for (const score of [{ home: 0 }, { away: 0 }]) {
      expect(
        confirmedManualScore(match, "api-football", {
          ...fixture,
          score: score as ProviderFixture["score"],
        }),
      ).toBeNull();
    }
    for (const status of ["live", "scheduled", "abandoned"] as const) {
      expect(
        confirmedManualScore(match, "api-football", { ...fixture, status }),
      ).toBeNull();
    }
    expect(confirmedManualScore(match, "other", fixture)).toBeNull();
    expect(
      confirmedManualScore(match, "api-football", {
        ...fixture,
        externalFixtureId: "124",
      }),
    ).toBeNull();
    expect(
      confirmedManualScore(match, "api-football", {
        ...fixture,
        homeTeam: fixture.awayTeam,
        awayTeam: fixture.homeTeam,
      }),
    ).toBeNull();
  });
});
