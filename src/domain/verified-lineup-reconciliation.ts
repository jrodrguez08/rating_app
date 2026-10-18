import type {
  MatchParticipant,
  VerifiedLineupParticipant,
  VerifiedLineupReconciliation,
  VerifiedLineupSnapshot,
} from "@/domain/models";

export interface VerifiedLineupComparison {
  status: VerifiedLineupReconciliation["status"];
  reason: string;
  providerParticipantCount: number;
}

type ProviderSubstituteParticipation =
  "confirmed_substitute" | "unused_substitute" | "unknown";

export function compareVerifiedLineupEvidence(
  verified: VerifiedLineupSnapshot,
  providerParticipants: readonly MatchParticipant[],
): VerifiedLineupComparison {
  const providerParticipantCount = providerParticipants.length;
  if (providerParticipantCount === 0) {
    return comparison(
      "provider_missing",
      "provider-lineup-unavailable",
      providerParticipantCount,
    );
  }

  if (
    providerParticipants.some(
      (participant) =>
        participant.matchId !== verified.matchId ||
        participant.teamId !== verified.trackedTeamId,
    )
  ) {
    return comparison(
      "conflict",
      "provider-fixture-binding-conflict",
      providerParticipantCount,
    );
  }

  const verifiedById = uniqueParticipantsById(verified.participants);
  if (verifiedById === null) {
    return comparison(
      "conflict",
      "verified-canonical-identity-duplicate",
      providerParticipantCount,
    );
  }
  const providerById = uniqueParticipantsById(providerParticipants);
  if (providerById === null) {
    return comparison(
      "conflict",
      "provider-canonical-identity-duplicate",
      providerParticipantCount,
    );
  }

  if (
    [...providerById.keys()].some((playerId) => !verifiedById.has(playerId))
  ) {
    return comparison(
      "conflict",
      "provider-canonical-identity-conflict",
      providerParticipantCount,
    );
  }

  let partialReason: string | undefined;
  for (const verifiedParticipant of verified.participants) {
    const providerParticipant = providerById.get(verifiedParticipant.playerId);
    if (providerParticipant === undefined) {
      partialReason ??= "provider-identities-incomplete";
      continue;
    }
    if (
      verifiedParticipant.identityProvenance === "operator_verified" &&
      verifiedParticipant.externalProviderPlayerId === undefined
    ) {
      partialReason ??= "verified-internal-identity-unresolved";
      continue;
    }
    if (providerParticipant.squadRole !== verifiedParticipant.squadRole) {
      return comparison(
        "conflict",
        "provider-role-conflict",
        providerParticipantCount,
      );
    }
    const participation = compareParticipation(
      verifiedParticipant,
      providerParticipant,
    );
    if (participation === "conflict") {
      return comparison(
        "conflict",
        "provider-participation-conflict",
        providerParticipantCount,
      );
    }
    if (participation === "partial") {
      partialReason ??= "provider-participation-incomplete";
    }
  }

  return partialReason === undefined
    ? comparison(
        "matched",
        "provider-evidence-compatible",
        providerParticipantCount,
      )
    : comparison("provider_partial", partialReason, providerParticipantCount);
}

export function selectDurableVerifiedLineupReconciliation(
  existing: VerifiedLineupReconciliation | null,
  incoming: VerifiedLineupReconciliation,
): VerifiedLineupReconciliation {
  if (existing === null) return incoming;
  if (
    existing.matchId !== incoming.matchId ||
    existing.trackedTeamId !== incoming.trackedTeamId ||
    existing.externalProvider !== incoming.externalProvider ||
    existing.externalFixtureId !== incoming.externalFixtureId
  ) {
    throw new Error(
      "Verified lineup reconciliation binding conflicts with persisted state.",
    );
  }
  if (sameObservation(existing, incoming)) return existing;

  const incomingConclusive = isConclusive(incoming.status);
  const existingConclusive = isConclusive(existing.status);
  if (incomingConclusive && existingConclusive) {
    const observedOrder = incoming.observedAt.localeCompare(
      existing.observedAt,
    );
    if (observedOrder < 0) return existing;
    if (observedOrder === 0 && existing.status === "conflict") return existing;
    return incoming;
  }
  if (incomingConclusive) return incoming;
  if (existingConclusive) return existing;

  if (
    existing.status === "provider_partial" &&
    incoming.status === "provider_missing"
  ) {
    return existing;
  }
  if (
    existing.status === "provider_partial" &&
    incoming.status === "provider_partial" &&
    (existing.providerParticipantCount ?? 0) >=
      (incoming.providerParticipantCount ?? 0)
  ) {
    return existing;
  }
  return incoming;
}

function compareParticipation(
  verified: VerifiedLineupParticipant,
  provider: MatchParticipant,
): "matched" | "partial" | "conflict" {
  if (verified.participationStatus === "confirmed_starter") {
    return provider.squadRole === "starter" ? "matched" : "conflict";
  }

  const providerParticipation = providerSubstituteParticipation(provider);
  if (verified.participationStatus === "confirmed_substitute") {
    return providerParticipation === "confirmed_substitute"
      ? "matched"
      : "partial";
  }
  if (verified.participationStatus === "unused_substitute") {
    if (providerParticipation === "confirmed_substitute") return "conflict";
    return providerParticipation === "unused_substitute"
      ? "matched"
      : "partial";
  }
  return providerParticipation === "confirmed_substitute"
    ? "conflict"
    : "partial";
}

function providerSubstituteParticipation(
  participant: MatchParticipant,
): ProviderSubstituteParticipation {
  if (
    participant.participated ||
    participant.participationStatus === "confirmed_substitute" ||
    participant.enteredAtMinute !== undefined
  ) {
    return "confirmed_substitute";
  }
  return participant.participationStatus === "unused_substitute"
    ? "unused_substitute"
    : "unknown";
}

function uniqueParticipantsById<T extends { playerId: string }>(
  participants: readonly T[],
): Map<string, T> | null {
  const byId = new Map<string, T>();
  for (const participant of participants) {
    if (byId.has(participant.playerId)) return null;
    byId.set(participant.playerId, participant);
  }
  return byId;
}

function comparison(
  status: VerifiedLineupComparison["status"],
  reason: string,
  providerParticipantCount: number,
): VerifiedLineupComparison {
  return { status, reason, providerParticipantCount };
}

function isConclusive(status: VerifiedLineupReconciliation["status"]): boolean {
  return status === "matched" || status === "conflict";
}

function sameObservation(
  left: VerifiedLineupReconciliation,
  right: VerifiedLineupReconciliation,
): boolean {
  return (
    left.status === right.status &&
    left.reason === right.reason &&
    left.providerParticipantCount === right.providerParticipantCount
  );
}
