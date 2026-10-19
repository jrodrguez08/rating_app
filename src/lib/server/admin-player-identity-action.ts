import { createHash } from "node:crypto";

export interface AdminPlayerIdentityAction {
  firstPlayerId: string;
  secondPlayerId: string;
  canonicalPlayerId: string;
  trackedTeamId: string;
  decision: "match" | "nonmatch";
}

export function hashAdminPlayerIdentityAction(
  action: AdminPlayerIdentityAction,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        firstPlayerId: action.firstPlayerId,
        secondPlayerId: action.secondPlayerId,
        canonicalPlayerId: action.canonicalPlayerId,
        trackedTeamId: action.trackedTeamId,
        decision: action.decision,
      }),
    )
    .digest("hex");
}

export function adminPlayerIdentityResourceId(
  action: AdminPlayerIdentityAction,
): string {
  return [action.firstPlayerId, action.secondPlayerId].sort().join(":");
}

export function adminPlayerIdentityAuditId(challengeId: string): string {
  return `player-identity-${challengeId}`;
}

export function playerIdentityReviewId(
  firstPlayerId: string,
  secondPlayerId: string,
): string {
  const pair = [firstPlayerId, secondPlayerId].sort();
  return createHash("sha256").update(pair.join(":")).digest("hex");
}
