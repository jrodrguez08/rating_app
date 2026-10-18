import { createHash } from "node:crypto";

import type { AdminLineupDraftParticipant } from "@/domain/models";

export interface AdminLineupDraftAction {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  baseVersion: number;
  participants: AdminLineupDraftParticipant[];
}

export function hashAdminLineupDraft(action: AdminLineupDraftAction): string {
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
            playerName: participant.playerName,
            createInternalIdentity: participant.createInternalIdentity,
            squadRole: participant.squadRole,
            participationStatus: participant.participationStatus,
            shirtNumber: participant.shirtNumber ?? null,
            position: participant.position ?? null,
            enteredAtMinute: participant.enteredAtMinute ?? null,
          })),
      }),
    )
    .digest("hex");
}
