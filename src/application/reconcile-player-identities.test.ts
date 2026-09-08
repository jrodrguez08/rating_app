import { describe, expect, it } from "vitest";

import type { Player, PlayerProviderAlias } from "@/domain/models";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";

import { planPlayerIdentityReconciliation } from "./reconcile-player-identities";

const reconciliation = {
  externalProvider: "api-football",
  canonicalExternalPlayerId: "36237",
  externalPlayerIds: ["36237", "541314"],
} as const;
const now = "2026-09-07T12:00:00.000Z";
const canonicalId = providerEntityId("player", "api-football", "36237");
const legacyId = providerEntityId("player", "api-football", "541314");

describe("player identity reconciliation", () => {
  it("keeps richer canonical metadata and plans both explicit aliases", () => {
    const plan = planPlayerIdentityReconciliation({
      reconciliation,
      players: new Map([
        [canonicalId, player(canonicalId, "36237", "midfielder")],
        [legacyId, player(legacyId, "541314")],
      ]),
      persistedAliases: new Map(),
      timestamp: now,
    });
    expect(plan.canonicalPlayerWrite).toBeNull();
    expect(plan.retainedLegacyPlayerIds).toEqual([legacyId]);
    expect(plan.aliasWrites).toHaveLength(2);
    expect(
      plan.aliasWrites.every(
        (alias) => alias.canonicalPlayerId === canonicalId,
      ),
    ).toBe(true);
  });

  it("fills missing metadata and is idempotent once aliases exist", () => {
    const first = planPlayerIdentityReconciliation({
      reconciliation,
      players: new Map([
        [canonicalId, player(canonicalId, "36237")],
        [legacyId, player(legacyId, "541314", "midfielder")],
      ]),
      persistedAliases: new Map(),
      timestamp: now,
    });
    expect(first.canonicalPlayerWrite?.position).toBe("midfielder");
    const aliases = new Map(
      first.aliasWrites.map((alias) => [alias.id, alias]),
    );
    const second = planPlayerIdentityReconciliation({
      reconciliation,
      players: new Map([[canonicalId, first.canonicalPlayerWrite!]]),
      persistedAliases: aliases,
      timestamp: now,
    });
    expect(second.canonicalPlayerWrite).toBeNull();
    expect(second.aliasWrites).toEqual([]);
  });

  it("rejects conflicting persisted mappings", () => {
    const id = playerProviderAliasId("api-football", "541314");
    const conflict: PlayerProviderAlias = {
      id,
      canonicalPlayerId: "different-player",
      canonicalExternalProviderPlayerId: "999",
      externalProvider: "api-football",
      externalProviderPlayerId: "541314",
      createdAt: now,
      updatedAt: now,
    };
    expect(() =>
      planPlayerIdentityReconciliation({
        reconciliation,
        players: new Map([[canonicalId, player(canonicalId, "36237")]]),
        persistedAliases: new Map([[id, conflict]]),
        timestamp: now,
      }),
    ).toThrow(/conflicts/i);
  });

  it("promotes only an unreconciled self-alias", () => {
    const id = playerProviderAliasId("api-football", "541314");
    const selfAlias: PlayerProviderAlias = {
      id,
      canonicalPlayerId: legacyId,
      canonicalExternalProviderPlayerId: "541314",
      externalProvider: "api-football",
      externalProviderPlayerId: "541314",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const plan = planPlayerIdentityReconciliation({
      reconciliation,
      players: new Map([[canonicalId, player(canonicalId, "36237")]]),
      persistedAliases: new Map([[id, selfAlias]]),
      timestamp: now,
    });
    expect(plan.aliasWrites).toContainEqual(
      expect.objectContaining({
        id,
        canonicalPlayerId: canonicalId,
        createdAt: selfAlias.createdAt,
      }),
    );
  });
});

function player(
  id: string,
  externalProviderId: string,
  position?: Player["position"],
): Player {
  return {
    id,
    displayName: "S. Rodriguez",
    externalProvider: "api-football",
    externalProviderId,
    ...(position === undefined ? {} : { position }),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
