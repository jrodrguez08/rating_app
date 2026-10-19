import { createHash } from "node:crypto";

export interface AdminManualVotingAction {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  finalWhistleConfirmed: true;
  verificationSource: string;
  verificationReason: string;
  closeMode: "default" | "custom";
  customClosesAtLocal?: string;
}

export function hashAdminManualVotingAction(
  action: AdminManualVotingAction,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        matchId: action.matchId,
        trackedTeamId: action.trackedTeamId,
        externalFixtureId: action.externalFixtureId,
        finalWhistleConfirmed: action.finalWhistleConfirmed,
        verificationSource: action.verificationSource,
        verificationReason: action.verificationReason,
        closeMode: action.closeMode,
        customClosesAtLocal: action.customClosesAtLocal ?? null,
      }),
    )
    .digest("hex");
}

export function adminManualVotingAuditId(challengeId: string): string {
  return `manual-voting-open-${challengeId}`;
}
