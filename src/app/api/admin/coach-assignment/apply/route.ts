import type { NextRequest } from "next/server";

import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import {
  AdminVerifiedCoachAssignmentCommitError,
  AdminVerifiedCoachAssignmentRejectedError,
  AdminVerifiedCoachService,
} from "@/lib/firebase/server";
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
  let clearChallenge = true;
  let assignmentStarted = false;
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
    assignmentStarted = true;
    const result = await new AdminVerifiedCoachService().assignAuthorized(
      { ...action, operatorId: identity.uid },
      request.cookies.get(ADMIN_ACTION_COOKIE)?.value,
    );
    response = adminJson({ applied: true, ...result });
  } catch (error) {
    const rejected = error instanceof AdminVerifiedCoachAssignmentRejectedError;
    const failed = error instanceof AdminVerifiedCoachAssignmentCommitError;
    if (audit && (!assignmentStarted || rejected || failed)) {
      await security.audit({
        operatorUid: audit.uid,
        action: "coach_assignment_apply",
        matchId: audit.matchId,
        coachId: audit.coachId,
        evidenceReference: audit.evidence,
        verificationReason: audit.reason,
        outcome: rejected ? "rejected" : "failed",
      });
    }
    if (audit && assignmentStarted && !rejected && !failed) {
      clearChallenge = false;
    }
    response = adminError(error);
  }
  if (clearChallenge) {
    response.cookies.set(ADMIN_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/coach-assignment/apply",
      maxAge: 0,
    });
  }
  return response;
}
