import { createHash } from "node:crypto";

import type { Coach, CoachProviderAlias } from "./models";
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

/** Read-only resolution: never establishes a reviewed mapping during assignment. */
export function resolveCoachAssignmentIdentity(
  provider: string,
  externalCoachId: string,
  alias: CoachProviderAlias | undefined,
  coach: Coach | undefined,
  selectedCoachId: string,
):
  | "COACH_ALIAS_MISSING"
  | "COACH_ALIAS_CONFLICT"
  | "COACH_PROVIDER_MISMATCH"
  | "COACH_INVALID_IDENTITY"
  | undefined {
  if (!/^[1-9]\d*$/.test(externalCoachId)) return "COACH_PROVIDER_MISMATCH";
  const proposed = proposedCoachProviderAlias(provider, externalCoachId, "");
  if (!alias && selectedCoachId !== proposed.canonicalCoachId)
    return "COACH_ALIAS_MISSING";
  if (
    alias &&
    (alias.id !== proposed.id ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(alias.canonicalCoachId))
  )
    return "COACH_ALIAS_CONFLICT";
  let resolved: CoachProviderAlias;
  try {
    resolved = resolvePersistedCoachProviderAlias(alias, proposed);
  } catch {
    return "COACH_ALIAS_CONFLICT";
  }
  if (resolved.canonicalCoachId !== selectedCoachId)
    return "COACH_ALIAS_CONFLICT";
  if (alias && !coach) return "COACH_INVALID_IDENTITY";
  if (
    coach &&
    (coach.externalProvider !== provider ||
      coach.externalProviderId !== externalCoachId)
  )
    return "COACH_PROVIDER_MISMATCH";
  return undefined;
}
