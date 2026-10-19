import { createHash } from "node:crypto";

export interface AdminPlayerIdentityAction {
  canonicalPlayerId: string;
  trackedTeamId: string;
  externalProvider: "api-football";
  externalProviderPlayerId: string;
  decision: "match" | "nonmatch";
  verificationSource: string;
  verificationReason: string;
}

export function hashAdminPlayerIdentityAction(
  action: AdminPlayerIdentityAction,
): string {
  return createHash("sha256").update(JSON.stringify(action)).digest("hex");
}

export function adminPlayerIdentityResourceId(
  action: AdminPlayerIdentityAction,
): string {
  return `${action.canonicalPlayerId}:${action.externalProvider}:${action.externalProviderPlayerId}`;
}

export function adminPlayerIdentityAuditId(challengeId: string): string {
  return `player-identity-${challengeId}`;
}

export function playerIdentityReviewId(
  canonicalPlayerId: string,
  externalProvider: string,
  externalProviderPlayerId: string,
): string {
  return createHash("sha256")
    .update(
      `${canonicalPlayerId}:${externalProvider}:${externalProviderPlayerId}`,
    )
    .digest("hex");
}
