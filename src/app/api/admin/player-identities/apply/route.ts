import type { NextRequest } from "next/server";

import {
  AdminPlayerIdentityCommitError,
  AdminPlayerIdentityRejectedError,
  AdminPlayerIdentityService,
} from "@/lib/firebase/admin-player-identity";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { ADMIN_PLAYER_IDENTITY_ACTION_COOKIE } from "@/lib/server/admin-auth";
import { adminPlayerIdentityResourceId } from "@/lib/server/admin-player-identity-action";
import {
  adminError,
  adminJson,
  parseAdminPlayerIdentityAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  const security = new AdminSecurityStore();
  let response;
  let clearChallenge = true;
  let applyStarted = false;
  let audit: { uid: string; resourceId: string } | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null)
      throw new Error("Invalid request.");
    const action = parseAdminPlayerIdentityAction(
      "action" in body ? body.action : undefined,
    );
    const resourceId = adminPlayerIdentityResourceId(action);
    audit = {
      uid: identity.uid,
      resourceId,
    };
    const confirmed = "confirmed" in body ? body.confirmed : undefined;
    if (confirmed !== true) {
      throw new Error("Debe confirmar la decisión antes de continuar.");
    }
    applyStarted = true;
    const result = await new AdminPlayerIdentityService().applyAuthorized(
      { ...action, operatorId: identity.uid },
      request.cookies.get(ADMIN_PLAYER_IDENTITY_ACTION_COOKIE)?.value,
    );
    response = adminJson({ applied: true, ...result });
  } catch (error) {
    const rejected = error instanceof AdminPlayerIdentityRejectedError;
    const failed = error instanceof AdminPlayerIdentityCommitError;
    if (audit && (!applyStarted || rejected || failed)) {
      await security.audit({
        operatorUid: audit.uid,
        action: "player_identity_apply",
        resourceId: audit.resourceId,
        outcome: failed ? "failed" : "rejected",
      });
    }
    if (audit && !rejected && !failed) clearChallenge = false;
    response = adminError(error);
  }
  if (clearChallenge) {
    response.cookies.set(ADMIN_PLAYER_IDENTITY_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/player-identities/apply",
      maxAge: 0,
    });
  }
  return response;
}
