import { describe, expect, it } from "vitest";

import type { Player } from "./models";
import {
  generateInternalPlayerId,
  isInternalPlayerId,
  mergePlayerForProviderSync,
  providerEntityId,
} from "./player-identity";

describe("player identity", () => {
  it("allocates opaque internal IDs with enough collision resistance", () => {
    const ids = new Set(Array.from({ length: 100 }, generateInternalPlayerId));

    expect(ids.size).toBe(100);
    expect([...ids].every(isInternalPlayerId)).toBe(true);
  });

  it("keeps deterministic provider IDs stable", () => {
    expect(providerEntityId("player", "api-football", "12345")).toBe(
      providerEntityId("player", "api-football", "12345"),
    );
  });

  it("preserves verified operator metadata during provider enrichment", () => {
    const existing: Player = {
      id: `player-internal-${"a".repeat(32)}`,
      displayName: "Nombre verificado",
      position: "midfielder",
      identityProvenance: "operator_verified",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const incoming: Player = {
      id: existing.id,
      displayName: "Nombre del proveedor",
      position: "attacker",
      currentTeamId: "team-1",
      externalProvider: "api-football",
      externalProviderId: "12345",
      createdAt: "2026-10-18T00:00:00.000Z",
      updatedAt: "2026-10-18T00:00:00.000Z",
    };

    expect(mergePlayerForProviderSync(existing, incoming)).toMatchObject({
      displayName: existing.displayName,
      position: existing.position,
      identityProvenance: "operator_verified",
      currentTeamId: "team-1",
      externalProviderId: "12345",
      createdAt: existing.createdAt,
    });
  });
});
