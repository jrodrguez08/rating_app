import type { NextRequest } from "next/server";

import {
  AdminCoachIdentityCommitError,
  AdminCoachIdentityRejectedError,
  AdminCoachIdentityService,
} from "@/lib/firebase/admin-coach-identity";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { ADMIN_COACH_IDENTITY_ACTION_COOKIE } from "@/lib/server/admin-auth";
import { adminCoachIdentityResourceId } from "@/lib/server/admin-coach-identity-action";
import {
  adminError,
  adminJson,
  parseAdminCoachIdentityAction,
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
    if (typeof body !== "object" || body === null) throw new Error();
    const action = parseAdminCoachIdentityAction(
      "action" in body ? body.action : undefined,
    );
    audit = {
      uid: identity.uid,
      resourceId: adminCoachIdentityResourceId(action),
    };
    if (!("confirmed" in body) || body.confirmed !== true) {
      throw new Error("Debe confirmar la decisión antes de continuar.");
    }
    applyStarted = true;
    const result = await new AdminCoachIdentityService().applyAuthorized(
      { ...action, operatorId: identity.uid },
      request.cookies.get(ADMIN_COACH_IDENTITY_ACTION_COOKIE)?.value,
    );
    response = adminJson({ applied: true, ...result });
  } catch (error) {
    const rejected = error instanceof AdminCoachIdentityRejectedError;
    const failed = error instanceof AdminCoachIdentityCommitError;
    if (audit && (!applyStarted || rejected || failed)) {
      await security.audit({
        operatorUid: audit.uid,
        action: "coach_identity_apply",
        resourceId: audit.resourceId,
        outcome: failed ? "failed" : "rejected",
      });
    }
    if (audit && !rejected && !failed) clearChallenge = false;
    response = rejected
      ? adminJson({ error: error.message }, 409)
      : adminError(error);
  }
  if (clearChallenge) {
    response.cookies.set(ADMIN_COACH_IDENTITY_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/coach-identities/apply",
      maxAge: 0,
    });
  }
  return response;
}
