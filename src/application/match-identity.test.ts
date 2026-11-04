import { describe, expect, it } from "vitest";

import type { Match } from "@/domain/models";

import {
  assertSameTrackedFixture,
  isMatchContextOwnedByTeam,
  isMatchOwnedByTeam,
  trackedMatchId,
} from "./match-identity";

describe("tracked Match identity", () => {
  it("preserves the historical Herediano ID and separates two tracked sides", () => {
    const herediano = trackedMatchId(
      "api-football",
      "1551706",
      "club-sport-herediano",
    );
    expect(herediano).toBe("match-10a50b08075ca1f0646e5b6d");
    const saprissa = trackedMatchId(
      "api-football",
      "1551706",
      "deportivo-saprissa",
    );
    expect(saprissa).not.toBe(herediano);
    expect(
      trackedMatchId("api-football", "1551706", "deportivo-saprissa"),
    ).toBe(saprissa);
    expect(
      trackedMatchId("other-provider", "1551706", "deportivo-saprissa"),
    ).not.toBe(saprissa);
  });

  it("rejects a provider upsert that changes a persisted Match binding", () => {
    const existing = {
      id: "match-one",
      trackedTeamId: "club-sport-herediano",
      trackedTeamExternalProviderId: "815",
      homeTeam: { externalProviderId: "815", name: "Herediano" },
      awayTeam: { externalProviderId: "3000", name: "Saprissa" },
      externalProvider: "api-football",
      externalProviderFixtureId: "fixture-123",
    } as Match;
    expect(isMatchOwnedByTeam(existing, existing.trackedTeamId)).toBe(true);
    expect(isMatchOwnedByTeam(existing, "deportivo-saprissa")).toBe(false);
    expect(
      isMatchOwnedByTeam(
        { ...existing, trackedTeamExternalProviderId: "unrelated" },
        existing.trackedTeamId,
      ),
    ).toBe(false);
    const context = {
      matchId: existing.id,
      teamId: existing.trackedTeamId,
      externalProviderTeamId: "815",
    };
    expect(isMatchContextOwnedByTeam(existing, context)).toBe(true);
    expect(
      isMatchContextOwnedByTeam(existing, {
        ...context,
        externalProviderTeamId: "3000",
      }),
    ).toBe(false);
    expect(() =>
      assertSameTrackedFixture(existing, { ...existing }),
    ).not.toThrow();
    for (const change of [
      { trackedTeamId: "deportivo-saprissa" },
      { trackedTeamExternalProviderId: "100" },
      { externalProvider: "other-provider" },
      { externalProviderFixtureId: "other-fixture" },
    ]) {
      expect(() =>
        assertSameTrackedFixture(existing, { ...existing, ...change }),
      ).toThrow("binding conflicts");
    }
  });
});
