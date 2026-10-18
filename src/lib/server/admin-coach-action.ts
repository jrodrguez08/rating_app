import { createHash } from "node:crypto";

export interface AdminCoachAction {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  coachId: string;
  coachName: string;
  externalProviderCoachId?: string;
  verificationSource: string;
  verificationReason: string;
}

export function hashAdminCoachAction(action: AdminCoachAction): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        matchId: action.matchId,
        trackedTeamId: action.trackedTeamId,
        externalFixtureId: action.externalFixtureId,
        coachId: action.coachId,
        coachName: action.coachName,
        externalProviderCoachId: action.externalProviderCoachId ?? null,
        verificationSource: action.verificationSource,
        verificationReason: action.verificationReason,
      }),
    )
    .digest("hex");
}

export function adminChallengeDocumentId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function adminCoachAssignmentAuditId(challengeId: string): string {
  return `coach-assignment-${challengeId}`;
}
