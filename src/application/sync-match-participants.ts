import { proposedPlayerProviderAlias } from "@/config/player-identity-reconciliations";
import type {
  Coach,
  CoachAssignment,
  MatchParticipant,
  Player,
  VerifiedCoachAssignment,
} from "@/domain/models";
import type {
  FootballDataProvider,
  FootballSyncStore,
  ProviderHeadCoach,
  ProviderParticipantContext,
  SyncWriteCounts,
} from "@/domain/ports";
import { providerEntityId } from "@/domain/player-identity";
import {
  emitOperationalLog,
  type OperationalLogger,
} from "@/lib/operational-log";
import { ProviderError } from "@/lib/providers/api-football/errors";

export { providerEntityId } from "@/domain/player-identity";

export interface MatchParticipantSyncSummary {
  matchId: string;
  externalFixtureId: string;
  starters: number;
  substitutes: number;
  participated: number;
  unusedSubstitutes: number;
  players: SyncWriteCounts;
  participants: SyncWriteCounts;
  coaches: SyncWriteCounts;
  coachAssignments: SyncWriteCounts;
  coach: { id: string; name: string };
  apiRequests: number;
}

interface ResolvedSyncCoach {
  externalTeamId: string;
  externalCoachId?: string;
  name: string;
  photoUrl?: string;
}

export async function syncMatchParticipants(
  matchId: string,
  provider: FootballDataProvider,
  store: FootballSyncStore,
  now = new Date(),
  phase: "lineup" | "final" = "final",
  log: OperationalLogger = () => undefined,
): Promise<MatchParticipantSyncSummary> {
  const match = await store.getMatch(matchId);
  const team = await store.getTeam(match.trackedTeamId);
  if (team.externalProviderId === undefined) {
    throw new Error(`Team ${team.id} has no provider mapping.`);
  }
  const externalTeamId = team.externalProviderId;
  if (match.externalProvider !== provider.name) {
    throw new Error(
      `Match ${match.id} belongs to ${match.externalProvider}, not ${provider.name}.`,
    );
  }

  const persistedContext =
    match.lineupSnapshotAt === undefined &&
    match.participantSyncedAt === undefined
      ? null
      : await store.getPersistedMatchContext(match.id, team.id, provider.name);
  const baseline =
    persistedContext === null &&
    store.getPersistedParticipantContext !== undefined &&
    (match.lineupSnapshotAt !== undefined ||
      match.participantSyncedAt !== undefined)
      ? await store.getPersistedParticipantContext(
          match.id,
          team.id,
          provider.name,
        )
      : persistedContext;
  const verifiedLineup =
    phase === "final" && store.getVerifiedLineupSnapshot !== undefined
      ? await store.getVerifiedLineupSnapshot(match.id)
      : null;
  const verifiedBaseline = verifiedLineupProviderBaseline({
    match,
    teamId: team.id,
    providerName: provider.name,
    externalTeamId,
    verifiedLineup,
  });
  if (
    verifiedLineup !== null &&
    store.replaceMatchParticipantContext === undefined
  ) {
    throw new Error(
      "Verified lineup reconciliation requires atomic context persistence.",
    );
  }
  let verified: Awaited<
    ReturnType<NonNullable<FootballSyncStore["getVerifiedCoachAssignment"]>>
  > = null;
  if (phase === "final" && store.getVerifiedCoachAssignment !== undefined) {
    try {
      verified = await store.getVerifiedCoachAssignment(match.id);
    } catch (error) {
      emitOperationalLog(log, "coach.manual_assignment", {
        matchId: match.id,
        status: "rejected",
        reason: "assignment-load-failed",
      });
      throw error;
    }
  }
  const evidence =
    phase === "lineup"
      ? null
      : provider.getMatchEvidence === undefined
        ? null
        : await provider.getMatchEvidence(
            match.externalProviderFixtureId,
            externalTeamId,
            verifiedBaseline ?? baseline ?? undefined,
            match.kickoffAt,
          );
  let context;
  if (phase === "lineup") {
    context = await provider.getLineupContext(
      match.externalProviderFixtureId,
      externalTeamId,
      match.kickoffAt,
    );
  } else if (evidence !== null) {
    const coachEvidence =
      evidence.coach.status === "unavailable" &&
      verified === null &&
      persistedContext !== null
        ? { status: "resolved" as const, value: persistedContext.headCoach }
        : evidence.coach;
    context = {
      participants: evidence.participants,
      headCoach: resolveCoach({
        match,
        providerName: provider.name,
        externalTeamId,
        evidence: coachEvidence,
        verified,
        log,
      }),
    };
  } else {
    const providerContext = await provider.getMatchContext(
      match.externalProviderFixtureId,
      externalTeamId,
      persistedContext ?? undefined,
      match.kickoffAt,
    );
    context =
      verified === null
        ? providerContext
        : {
            participants: providerContext.participants,
            headCoach: resolveCoach({
              match,
              providerName: provider.name,
              externalTeamId,
              evidence: {
                status: "resolved",
                value: providerContext.headCoach,
              },
              verified,
              log,
            }),
          };
  }
  if (context === null) {
    throw new Error(
      `No usable lineup has been observed for fixture ${match.externalProviderFixtureId}; retry after provider cache propagation.`,
    );
  }
  const timestamp = now.toISOString();
  const trackedParticipants = context.participants.filter(
    (participant) => participant.externalTeamId === externalTeamId,
  );
  if (trackedParticipants.length === 0 && verifiedLineup === null) {
    throw new Error(
      `Provider returned no participants for tracked Team ${externalTeamId}.`,
    );
  }
  if (context.headCoach.externalTeamId !== externalTeamId) {
    throw new Error(
      `Provider returned a head coach for Team ${context.headCoach.externalTeamId}, not tracked Team ${externalTeamId}.`,
    );
  }
  const aliases = await store.resolvePlayerProviderAliases(
    trackedParticipants.map((participant) =>
      proposedPlayerProviderAlias(
        provider.name,
        participant.externalPlayerId,
        timestamp,
      ),
    ),
  );
  const canonicalIds = new Map(
    aliases.map((alias) => [alias.externalProviderPlayerId, alias]),
  );
  const players: Player[] = trackedParticipants.map((participant) => ({
    id: canonicalIds.get(participant.externalPlayerId)!.canonicalPlayerId,
    displayName: participant.name,
    identityProvenance: "provider",
    externalProvider: provider.name,
    externalProviderId: canonicalIds.get(participant.externalPlayerId)!
      .canonicalExternalProviderPlayerId,
    ...(participant.position === undefined
      ? {}
      : { position: participant.position }),
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const participants: MatchParticipant[] = trackedParticipants.map(
    (participant, index) => ({
      matchId: match.id,
      playerId: players[index].id,
      teamId: team.id,
      externalProvider: provider.name,
      externalProviderTeamId: externalTeamId,
      externalProviderPlayerId: participant.externalPlayerId,
      playerName: participant.name,
      ...(participant.shirtNumber === undefined
        ? {}
        : { shirtNumber: participant.shirtNumber }),
      ...(participant.position === undefined
        ? {}
        : { position: participant.position }),
      squadRole: participant.squadRole,
      starter: participant.squadRole === "starter",
      participated: participant.participated,
      participationStatus:
        participant.squadRole === "starter"
          ? "confirmed_starter"
          : participant.participated
            ? "confirmed_substitute"
            : "unused_substitute",
      identityProvenance: "provider",
      participationProvenance: "provider",
      ...(participant.enteredAtMinute === undefined
        ? {}
        : { enteredAtMinute: participant.enteredAtMinute }),
      ...(participant.exitedAtMinute === undefined
        ? {}
        : { exitedAtMinute: participant.exitedAtMinute }),
      ...(participant.captain === undefined
        ? {}
        : { captain: participant.captain }),
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  const coach: Coach =
    verified !== null
      ? { ...verified.coach, updatedAt: timestamp }
      : {
          id: providerEntityId(
            "coach",
            provider.name,
            requiredProviderCoachId(context.headCoach),
          ),
          displayName: context.headCoach.name,
          identityProvenance: "provider",
          externalProvider: provider.name,
          externalProviderId: requiredProviderCoachId(context.headCoach),
          ...(context.headCoach.photoUrl === undefined
            ? {}
            : { photoUrl: context.headCoach.photoUrl }),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
  const coachId = coach.id;
  const assignment: CoachAssignment = {
    matchId: match.id,
    coachId,
    teamId: team.id,
    externalProviderTeamId: externalTeamId,
    role: "head-coach",
    coachName: coach.displayName,
    provenance: verified !== null ? "operator_verified" : "provider",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const counts =
    store.replaceMatchParticipantContext === undefined
      ? {
          players: await store.upsertPlayers(players),
          participants: await store.replaceMatchParticipants(
            match.id,
            participants,
          ),
          coaches: await store.upsertCoaches([coach]),
          coachAssignments: await store.upsertCoachAssignment(
            match.id,
            assignment,
          ),
        }
      : await store.replaceMatchParticipantContext(match.id, {
          players,
          participants,
          coach,
          assignment,
        });
  const summaryParticipants = verifiedLineup?.participants ?? participants;
  emitOperationalLog(log, "participants.reconciliation", {
    matchId: match.id,
    status: "completed",
    participantCount: summaryParticipants.length,
    participated: summaryParticipants.filter((value) => value.participated)
      .length,
    coachProvenance: assignment.provenance ?? "provider",
  });

  return {
    matchId: match.id,
    externalFixtureId: match.externalProviderFixtureId,
    starters: summaryParticipants.filter(
      (value) => value.squadRole === "starter",
    ).length,
    substitutes: summaryParticipants.filter(
      (value) => value.squadRole === "substitute",
    ).length,
    participated: summaryParticipants.filter((value) => value.participated)
      .length,
    unusedSubstitutes: summaryParticipants.filter(
      (value) => value.squadRole === "substitute" && !value.participated,
    ).length,
    players: counts.players,
    participants: counts.participants,
    coaches: counts.coaches,
    coachAssignments: counts.coachAssignments,
    coach: { id: coach.id, name: coach.displayName },
    apiRequests: provider.requestCount,
  };
}

function verifiedLineupProviderBaseline({
  match,
  teamId,
  providerName,
  externalTeamId,
  verifiedLineup,
}: {
  match: Awaited<ReturnType<FootballSyncStore["getMatch"]>>;
  teamId: string;
  providerName: string;
  externalTeamId: string;
  verifiedLineup: Awaited<
    ReturnType<NonNullable<FootballSyncStore["getVerifiedLineupSnapshot"]>>
  >;
}): ProviderParticipantContext | null {
  if (verifiedLineup === null) return null;
  if (
    verifiedLineup.matchId !== match.id ||
    verifiedLineup.trackedTeamId !== teamId ||
    verifiedLineup.externalProvider !== providerName ||
    verifiedLineup.externalFixtureId !== match.externalProviderFixtureId ||
    verifiedLineup.provenance !== "operator_verified"
  ) {
    throw new Error("Verified lineup does not match the fixture.");
  }
  return {
    participants: verifiedLineup.participants.flatMap((participant) =>
      participant.externalProviderPlayerId === undefined
        ? []
        : [
            {
              externalTeamId,
              externalPlayerId: participant.externalProviderPlayerId,
              name: participant.playerName,
              ...(participant.shirtNumber === undefined
                ? {}
                : { shirtNumber: participant.shirtNumber }),
              ...(participant.position === undefined
                ? {}
                : { position: participant.position }),
              squadRole: participant.squadRole,
              participated: participant.participated,
              ...(participant.enteredAtMinute === undefined
                ? {}
                : { enteredAtMinute: participant.enteredAtMinute }),
            },
          ],
    ),
  };
}

function resolveCoach({
  match,
  providerName,
  externalTeamId,
  evidence,
  verified,
  log,
}: {
  match: Awaited<ReturnType<FootballSyncStore["getMatch"]>>;
  providerName: string;
  externalTeamId: string;
  evidence:
    | { status: "resolved"; value: ProviderHeadCoach }
    | { status: "unavailable"; reason: "coach-missing" | "ambiguous-coach" };
  verified: { assignment: VerifiedCoachAssignment; coach: Coach } | null;
  log: OperationalLogger;
}): ResolvedSyncCoach {
  if (verified !== null) {
    const { assignment, coach } = verified;
    const validBinding =
      assignment.matchId === match.id &&
      assignment.trackedTeamId === match.trackedTeamId &&
      assignment.externalProvider === providerName &&
      assignment.externalFixtureId === match.externalProviderFixtureId &&
      assignment.coachId === coach.id &&
      assignment.provenance === "operator_verified" &&
      coach.displayName.trim() !== "";
    if (!validBinding) {
      emitOperationalLog(log, "coach.manual_assignment", {
        matchId: match.id,
        status: "rejected",
        reason: "binding-invalid",
      });
      throw new Error("Verified coach assignment does not match the fixture.");
    }
    if (evidence.status === "resolved") {
      const sameProviderIdentity =
        coach.externalProvider === providerName &&
        coach.externalProviderId === evidence.value.externalCoachId;
      if (!sameProviderIdentity) {
        emitOperationalLog(log, "coach.manual_assignment", {
          matchId: match.id,
          status: "conflict",
          reason: "provider-identity-differs",
        });
        throw new Error(
          "Provider coach identity conflicts with the verified assignment.",
        );
      }
    } else if (evidence.reason !== "ambiguous-coach") {
      emitOperationalLog(log, "coach.manual_assignment", {
        matchId: match.id,
        status: "rejected",
        reason: evidence.reason,
      });
      throw new ProviderError(
        evidence.reason,
        "Provider coach identity is unavailable for a non-recoverable reason.",
      );
    }
    emitOperationalLog(log, "coach.manual_assignment", {
      matchId: match.id,
      status: "accepted",
      reason:
        evidence.status === "resolved"
          ? "provider-identity-confirmed"
          : "ambiguous-coach-recovered",
    });
    return {
      externalTeamId,
      name: coach.displayName,
      ...(coach.photoUrl === undefined ? {} : { photoUrl: coach.photoUrl }),
    };
  }
  if (evidence.status === "unavailable") {
    emitOperationalLog(log, "coach.manual_assignment", {
      matchId: match.id,
      status: "missing",
      reason: evidence.reason,
    });
    throw new ProviderError(
      evidence.reason,
      `No verified coach assignment can recover ${evidence.reason}.`,
    );
  }
  return evidence.value;
}

function requiredProviderCoachId(coach: ResolvedSyncCoach): string {
  if (coach.externalCoachId === undefined) {
    throw new Error("Provider coach identity is missing its provider ID.");
  }
  return coach.externalCoachId;
}
