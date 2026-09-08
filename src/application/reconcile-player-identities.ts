import {
  proposedPlayerProviderAlias,
  type PlayerIdentityReconciliation,
} from "@/config/player-identity-reconciliations";
import type { Player, PlayerProviderAlias } from "@/domain/models";
import { providerEntityId } from "@/domain/player-identity";

export interface PlayerIdentityReconciliationPlan {
  canonicalPlayerId: string;
  canonicalPlayer: Player;
  canonicalPlayerWrite: Player | null;
  aliasWrites: PlayerProviderAlias[];
  retainedLegacyPlayerIds: string[];
}

export function planPlayerIdentityReconciliation({
  reconciliation,
  players,
  persistedAliases,
  timestamp,
}: {
  reconciliation: PlayerIdentityReconciliation;
  players: ReadonlyMap<string, Player>;
  persistedAliases: ReadonlyMap<string, PlayerProviderAlias>;
  timestamp: string;
}): PlayerIdentityReconciliationPlan {
  const canonicalPlayerId = providerEntityId(
    "player",
    reconciliation.externalProvider,
    reconciliation.canonicalExternalPlayerId,
  );
  const canonical = players.get(canonicalPlayerId);
  if (canonical === undefined) {
    throw new Error(
      `Canonical Player ${canonicalPlayerId} must exist before reconciliation.`,
    );
  }
  const aliases = reconciliation.externalPlayerIds.map((externalPlayerId) =>
    proposedPlayerProviderAlias(
      reconciliation.externalProvider,
      externalPlayerId,
      timestamp,
    ),
  );
  const aliasWrites = aliases
    .filter((proposed) => {
      const existing = persistedAliases.get(proposed.id);
      return playerProviderAliasTransition(existing, proposed) !== "unchanged";
    })
    .map((proposed) => ({
      ...proposed,
      createdAt:
        persistedAliases.get(proposed.id)?.createdAt ?? proposed.createdAt,
    }));
  const legacyPlayers = reconciliation.externalPlayerIds
    .map((externalPlayerId) =>
      players.get(
        providerEntityId(
          "player",
          reconciliation.externalProvider,
          externalPlayerId,
        ),
      ),
    )
    .filter((player): player is Player => player !== undefined);
  const merged = {
    ...canonical,
    position:
      canonical.position ??
      legacyPlayers.find((player) => player.position !== undefined)?.position,
    photoUrl:
      canonical.photoUrl ??
      legacyPlayers.find((player) => player.photoUrl !== undefined)?.photoUrl,
    updatedAt: timestamp,
  };
  const canonicalPlayerWrite =
    canonical.position === merged.position &&
    canonical.photoUrl === merged.photoUrl
      ? null
      : merged;
  return {
    canonicalPlayerId,
    canonicalPlayer: canonical,
    canonicalPlayerWrite,
    aliasWrites,
    retainedLegacyPlayerIds: legacyPlayers
      .map((player) => player.id)
      .filter((playerId) => playerId !== canonicalPlayerId),
  };
}

export function playerProviderAliasTransition(
  existing: PlayerProviderAlias | undefined,
  proposed: PlayerProviderAlias,
): "create" | "reconcile-self" | "unchanged" {
  if (existing === undefined) return "create";
  const mappingMatches =
    existing.canonicalPlayerId === proposed.canonicalPlayerId &&
    existing.canonicalExternalProviderPlayerId ===
      proposed.canonicalExternalProviderPlayerId &&
    existing.externalProvider === proposed.externalProvider &&
    existing.externalProviderPlayerId === proposed.externalProviderPlayerId;
  if (mappingMatches) return "unchanged";
  const isUnreconciledSelfAlias =
    existing.externalProvider === proposed.externalProvider &&
    existing.externalProviderPlayerId === proposed.externalProviderPlayerId &&
    existing.canonicalPlayerId ===
      providerEntityId(
        "player",
        existing.externalProvider,
        existing.externalProviderPlayerId,
      ) &&
    existing.canonicalExternalProviderPlayerId ===
      existing.externalProviderPlayerId;
  if (isUnreconciledSelfAlias) return "reconcile-self";
  throw new Error(
    `Player provider alias ${proposed.id} conflicts with its persisted canonical identity.`,
  );
}
