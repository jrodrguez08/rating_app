import type { NextRequest } from "next/server";

import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { AdminVerifiedCoachService } from "@/lib/firebase/server";
import { ADMIN_ACTION_COOKIE } from "@/lib/server/admin-auth";
import {
  adminError,
  adminJson,
  parseAdminCoachAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  const security = new AdminSecurityStore();
  let response;
  let audit:
    | {
        uid: string;
        matchId: string;
        coachId: string;
        evidence: string;
        reason: string;
      }
    | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null)
      throw new Error("Invalid request.");
    const action = parseAdminCoachAction(
      "action" in body ? body.action : undefined,
    );
    audit = {
      uid: identity.uid,
      matchId: action.matchId,
      coachId: action.coachId,
      evidence: action.verificationSource,
      reason: action.verificationReason,
    };
    const confirmation = "confirmation" in body ? body.confirmation : undefined;
    if (confirmation !== `assign-verified-coach:${action.matchId}`) {
      throw new Error("La confirmación no coincide con el partido.");
    }
    await security.consumeChallenge(
      identity.uid,
      action,
      request.cookies.get(ADMIN_ACTION_COOKIE)?.value,
    );
    const plan = await new AdminVerifiedCoachService().assign(
      { ...action, operatorId: identity.uid },
      true,
    );
    const auditId = await security.audit({
      operatorUid: identity.uid,
      action: "coach_assignment_apply",
      matchId: action.matchId,
      coachId: action.coachId,
      evidenceReference: action.verificationSource,
      verificationReason: action.verificationReason,
      outcome: "success",
    });
    response = adminJson({ applied: true, plan, auditId });
  } catch (error) {
    if (audit) {
      await security.audit({
        operatorUid: audit.uid,
        action: "coach_assignment_apply",
        matchId: audit.matchId,
        coachId: audit.coachId,
        evidenceReference: audit.evidence,
        verificationReason: audit.reason,
        outcome: "failed",
      });
    }
    response = adminError(error);
  }
  response.cookies.set(ADMIN_ACTION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/api/admin/coach-assignment/apply",
    maxAge: 0,
  });
  return response;
}
