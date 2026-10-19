import { createHash, randomBytes } from "node:crypto";

import type { Player, PlayerProviderAlias } from "./models";

export function providerEntityId(
  kind: "player" | "coach",
  provider: string,
  externalId: string,
): string {
  const digest = createHash("sha256")
    .update(`${provider}:${kind}:${externalId}`)
    .digest("hex")
    .slice(0, 24);
  return `${kind}-${digest}`;
}

const INTERNAL_PLAYER_ID_PATTERN = /^player-internal-[a-f0-9]{32}$/;

export function generateInternalPlayerId(): string {
  return `player-internal-${randomBytes(16).toString("hex")}`;
}

export function isInternalPlayerId(value: string): boolean {
  return INTERNAL_PLAYER_ID_PATTERN.test(value);
}

export function playerProviderAliasId(
  provider: string,
  externalPlayerId: string,
): string {
  const digest = createHash("sha256")
    .update(`${provider}:player-alias:${externalPlayerId}`)
    .digest("hex")
    .slice(0, 24);
  return `player-alias-${digest}`;
}

export function canonicalPlayerIdMap(
  aliases: readonly PlayerProviderAlias[],
): ReadonlyMap<string, string> {
  return new Map(
    aliases.map(
      ({ canonicalPlayerId, externalProvider, externalProviderPlayerId }) => [
        providerEntityId("player", externalProvider, externalProviderPlayerId),
        canonicalPlayerId,
      ],
    ),
  );
}

export function mergePlayerForProviderSync(
  existing: Player | undefined,
  incoming: Player,
): Player {
  if (!existing) return incoming;
  if (existing.identityProvenance !== "operator_verified") {
    return { ...existing, ...incoming, createdAt: existing.createdAt };
  }
  return {
    ...existing,
    currentTeamId: incoming.currentTeamId ?? existing.currentTeamId,
    externalProvider: incoming.externalProvider ?? existing.externalProvider,
    externalProviderId:
      incoming.externalProviderId ?? existing.externalProviderId,
    position: existing.position ?? incoming.position,
    photoUrl: existing.photoUrl ?? incoming.photoUrl,
    updatedAt: incoming.updatedAt,
  };
}
