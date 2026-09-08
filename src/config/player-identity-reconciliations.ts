import type { PlayerProviderAlias } from "@/domain/models";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";

export interface PlayerIdentityReconciliation {
  externalProvider: string;
  canonicalExternalPlayerId: string;
  externalPlayerIds: readonly string[];
}

export const PLAYER_IDENTITY_RECONCILIATIONS: readonly PlayerIdentityReconciliation[] =
  [
    {
      externalProvider: "api-football",
      canonicalExternalPlayerId: "36237",
      externalPlayerIds: ["36237", "541314"],
    },
    {
      externalProvider: "api-football",
      canonicalExternalPlayerId: "404115",
      externalPlayerIds: ["404115", "669618"],
    },
    {
      externalProvider: "api-football",
      canonicalExternalPlayerId: "512850",
      externalPlayerIds: ["512850", "628817"],
    },
  ];

export function proposedPlayerProviderAlias(
  externalProvider: string,
  externalProviderPlayerId: string,
  timestamp: string,
): PlayerProviderAlias {
  const reconciliation = PLAYER_IDENTITY_RECONCILIATIONS.find(
    (value) =>
      value.externalProvider === externalProvider &&
      value.externalPlayerIds.includes(externalProviderPlayerId),
  );
  const canonicalExternalPlayerId =
    reconciliation?.canonicalExternalPlayerId ?? externalProviderPlayerId;
  return {
    id: playerProviderAliasId(externalProvider, externalProviderPlayerId),
    canonicalPlayerId: providerEntityId(
      "player",
      externalProvider,
      canonicalExternalPlayerId,
    ),
    canonicalExternalProviderPlayerId: canonicalExternalPlayerId,
    externalProvider,
    externalProviderPlayerId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
