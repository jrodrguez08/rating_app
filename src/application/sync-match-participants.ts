import { createHash } from "node:crypto";

import type {
  Coach,
  CoachAssignment,
  MatchParticipant,
  Player,
} from "@/domain/models";
import type {
  FootballDataProvider,
  FootballSyncStore,
  SyncWriteCounts,
} from "@/domain/ports";

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

export async function syncMatchParticipants(
  matchId: string,
  provider: FootballDataProvider,
  store: FootballSyncStore,
  now = new Date(),
  phase: "lineup" | "final" = "final",
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

  const baseline =
    match.lineupSnapshotAt === undefined &&
    match.participantSyncedAt === undefined
      ? null
      : await store.getPersistedMatchContext(match.id, team.id, provider.name);
  const context =
    phase === "lineup"
      ? await provider.getLineupContext(
          match.externalProviderFixtureId,
          externalTeamId,
        )
      : await provider.getMatchContext(
          match.externalProviderFixtureId,
          externalTeamId,
          baseline ?? undefined,
        );
  if (context === null) {
    throw new Error(
      `No usable lineup has been observed for fixture ${match.externalProviderFixtureId}; retry after provider cache propagation.`,
    );
  }
  const timestamp = now.toISOString();
  const trackedParticipants = context.participants.filter(
    (participant) => participant.externalTeamId === externalTeamId,
  );
  if (trackedParticipants.length === 0) {
    throw new Error(
      `Provider returned no participants for tracked Team ${externalTeamId}.`,
    );
  }
  if (context.headCoach.externalTeamId !== externalTeamId) {
    throw new Error(
      `Provider returned a head coach for Team ${context.headCoach.externalTeamId}, not tracked Team ${externalTeamId}.`,
    );
  }
  const players: Player[] = trackedParticipants.map((participant) => ({
    id: providerEntityId("player", provider.name, participant.externalPlayerId),
    displayName: participant.name,
    externalProvider: provider.name,
    externalProviderId: participant.externalPlayerId,
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
  const coachId = providerEntityId(
    "coach",
    provider.name,
    context.headCoach.externalCoachId,
  );
  const coach: Coach = {
    id: coachId,
    displayName: context.headCoach.name,
    externalProvider: provider.name,
    externalProviderId: context.headCoach.externalCoachId,
    ...(context.headCoach.photoUrl === undefined
      ? {}
      : { photoUrl: context.headCoach.photoUrl }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const assignment: CoachAssignment = {
    matchId: match.id,
    coachId,
    teamId: team.id,
    externalProviderTeamId: externalTeamId,
    role: "head-coach",
    coachName: coach.displayName,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const playerCounts = await store.upsertPlayers(players);
  const participantCounts = await store.replaceMatchParticipants(
    match.id,
    participants,
  );
  const coachCounts = await store.upsertCoaches([coach]);
  const assignmentCounts = await store.upsertCoachAssignment(
    match.id,
    assignment,
  );

  return {
    matchId: match.id,
    externalFixtureId: match.externalProviderFixtureId,
    starters: participants.filter((value) => value.starter).length,
    substitutes: participants.filter((value) => !value.starter).length,
    participated: participants.filter((value) => value.participated).length,
    unusedSubstitutes: participants.filter(
      (value) => !value.starter && !value.participated,
    ).length,
    players: playerCounts,
    participants: participantCounts,
    coaches: coachCounts,
    coachAssignments: assignmentCounts,
    coach: { id: coach.id, name: coach.displayName },
    apiRequests: provider.requestCount,
  };
}
