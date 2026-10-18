import { createHash } from "node:crypto";

export interface AdminLifecycleAction {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
}

export function hashAdminLifecycleAction(action: AdminLifecycleAction): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        matchId: action.matchId,
        trackedTeamId: action.trackedTeamId,
        externalFixtureId: action.externalFixtureId,
      }),
    )
    .digest("hex");
}

export function adminLifecycleAuditId(challengeId: string): string {
  return `lifecycle-request-${challengeId}`;
}
