import { createHash } from "node:crypto";

import type { PlayerProviderAlias } from "./models";

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
