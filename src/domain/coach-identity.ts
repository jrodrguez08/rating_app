import { createHash } from "node:crypto";

import type { CoachProviderAlias } from "./models";
import { providerEntityId } from "./player-identity";

export function coachProviderAliasId(
  provider: string,
  externalCoachId: string,
): string {
  const digest = createHash("sha256")
    .update(`${provider}:coach-alias:${externalCoachId}`)
    .digest("hex")
    .slice(0, 24);
  return `coach-alias-${digest}`;
}

export function proposedCoachProviderAlias(
  provider: string,
  externalCoachId: string,
  timestamp: string,
  canonicalCoachId = providerEntityId("coach", provider, externalCoachId),
): CoachProviderAlias {
  return {
    id: coachProviderAliasId(provider, externalCoachId),
    canonicalCoachId,
    externalProvider: provider,
    externalProviderCoachId: externalCoachId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function resolvePersistedCoachProviderAlias(
  existing: CoachProviderAlias | undefined,
  proposed: CoachProviderAlias,
): CoachProviderAlias {
  if (!existing) return proposed;
  if (
    existing.externalProvider !== proposed.externalProvider ||
    existing.externalProviderCoachId !== proposed.externalProviderCoachId
  ) {
    throw new Error(`Coach provider alias ${proposed.id} has invalid binding.`);
  }
  const proposedIsDefault =
    proposed.canonicalCoachId ===
    providerEntityId(
      "coach",
      proposed.externalProvider,
      proposed.externalProviderCoachId,
    );
  if (proposedIsDefault) return existing;
  if (existing.canonicalCoachId === proposed.canonicalCoachId) return existing;
  const existingIsDefault =
    existing.canonicalCoachId ===
    providerEntityId(
      "coach",
      existing.externalProvider,
      existing.externalProviderCoachId,
    );
  if (!existingIsDefault) {
    throw new Error(
      `Coach provider alias ${proposed.id} already has a canonical identity.`,
    );
  }
  return { ...proposed, createdAt: existing.createdAt };
}
