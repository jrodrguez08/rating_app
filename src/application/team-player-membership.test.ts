import { describe, expect, it } from "vitest";

import type { TeamPlayerMembership } from "@/domain/models";

import { mergeTeamPlayerMembership } from "./team-player-membership";

describe("Team Player membership evidence", () => {
  it("preserves operator verified evidence while accepting newer presentation data", () => {
    const verified = membership({
      displayName: "Nombre verificado",
      source: "operator_verified",
      sourceMatchId: "match-verified",
      lastObservedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const current = membership({
      displayName: "Nombre actualizado",
      source: "current_squad",
      lastObservedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    expect(mergeTeamPlayerMembership(verified, current)).toMatchObject({
      displayName: "Nombre actualizado",
      source: "operator_verified",
      sourceMatchId: "match-verified",
      firstObservedAt: "2026-01-01T00:00:00.000Z",
      lastObservedAt: "2026-02-01T00:00:00.000Z",
    });
  });
});

function membership(
  overrides: Partial<TeamPlayerMembership>,
): TeamPlayerMembership {
  return {
    playerId: "player-1",
    teamId: "team-1",
    displayName: "Jugador",
    searchName: "jugador",
    searchPrefixes: ["j", "ju", "jug"],
    source: "match_participant",
    firstObservedAt: "2026-01-01T00:00:00.000Z",
    lastObservedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
