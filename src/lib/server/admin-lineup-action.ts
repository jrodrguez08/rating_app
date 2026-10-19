import { createHash } from "node:crypto";

import type {
  ParticipationStatus,
  PlayerPosition,
  SquadRole,
} from "@/domain/models";

export interface AdminLineupParticipantAction {
  playerId: string;
  playerName?: string;
  createInternalIdentity: boolean;
  identityAllocationToken?: string;
  squadRole: SquadRole;
  participationStatus: ParticipationStatus;
  shirtNumber?: number;
  position?: PlayerPosition;
  enteredAtMinute?: number;
}

export interface AdminLineupAction {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  participants: AdminLineupParticipantAction[];
  verificationSource: string;
  verificationReason: string;
}

export function hashAdminLineupAction(action: AdminLineupAction): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        matchId: action.matchId,
        trackedTeamId: action.trackedTeamId,
        externalFixtureId: action.externalFixtureId,
        participants: [...action.participants]
          .sort((left, right) => left.playerId.localeCompare(right.playerId))
          .map((participant) => ({
            playerId: participant.playerId,
            playerName: participant.playerName ?? null,
            createInternalIdentity: participant.createInternalIdentity,
            identityAllocationToken:
              participant.identityAllocationToken ?? null,
            squadRole: participant.squadRole,
            participationStatus: participant.participationStatus,
            shirtNumber: participant.shirtNumber ?? null,
            position: participant.position ?? null,
            enteredAtMinute: participant.enteredAtMinute ?? null,
          })),
        verificationSource: action.verificationSource,
        verificationReason: action.verificationReason,
      }),
    )
    .digest("hex");
}

export function adminLineupAuditId(challengeId: string): string {
  return `lineup-preparation-${challengeId}`;
}
