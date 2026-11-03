import { createHash } from "node:crypto";

export interface AdminCoachIdentityAction {
  trackedTeamId: string;
  firstCoachId: string;
  secondCoachId: string;
  canonicalCoachId: string;
  decision: "match" | "nonmatch";
}

export function hashAdminCoachIdentityAction(
  action: AdminCoachIdentityAction,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        trackedTeamId: action.trackedTeamId,
        firstCoachId: action.firstCoachId,
        secondCoachId: action.secondCoachId,
        canonicalCoachId: action.canonicalCoachId,
        decision: action.decision,
      }),
    )
    .digest("hex");
}

export function adminCoachIdentityResourceId(
  action: AdminCoachIdentityAction,
): string {
  return `${action.trackedTeamId}:${[action.firstCoachId, action.secondCoachId].sort().join(":")}`;
}

export function adminCoachIdentityAuditId(challengeId: string): string {
  return `coach-identity-${challengeId}`;
}

export function coachIdentityReviewId(
  firstCoachId: string,
  secondCoachId: string,
): string {
  return createHash("sha256")
    .update([firstCoachId, secondCoachId].sort().join(":"))
    .digest("hex");
}
