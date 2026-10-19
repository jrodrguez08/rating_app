import type { NextRequest } from "next/server";

import {
  AdminVerifiedLineupCommitError,
  AdminVerifiedLineupRejectedError,
  AdminVerifiedLineupService,
} from "@/lib/firebase/admin-lineup";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { ADMIN_LINEUP_ACTION_COOKIE } from "@/lib/server/admin-auth";
import { AdminLineupError } from "@/lib/server/admin-lineup-error";
import {
  adminLineupError,
  adminJson,
  parseAdminLineupAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  const security = new AdminSecurityStore();
  let response;
  let clearChallenge = true;
  let applyStarted = false;
  let matchId: string | undefined;
  let audit:
    | {
        uid: string;
        matchId: string;
        evidence: string;
        reason: string;
      }
    | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new Error("Invalid request.");
    }
    const action = parseAdminLineupAction(
      "action" in body ? body.action : undefined,
    );
    matchId = action.matchId;
    audit = {
      uid: identity.uid,
      matchId: action.matchId,
      evidence: action.verificationSource,
      reason: action.verificationReason,
    };
    const confirmation = "confirmation" in body ? body.confirmation : undefined;
    if (confirmation !== `prepare-verified-lineup:${action.matchId}`) {
      throw new AdminLineupError(
        "LINEUP_INVALID_INPUT",
        "The confirmation does not match the fixture.",
      );
    }
    applyStarted = true;
    const result = await new AdminVerifiedLineupService().applyAuthorized(
      { ...action, operatorId: identity.uid },
      request.cookies.get(ADMIN_LINEUP_ACTION_COOKIE)?.value,
    );
    response = adminJson({ applied: true, ...result });
  } catch (error) {
    const rejected = error instanceof AdminVerifiedLineupRejectedError;
    const failed = error instanceof AdminVerifiedLineupCommitError;
    if (audit && (!applyStarted || rejected || failed)) {
      await security.audit({
        operatorUid: audit.uid,
        action: "lineup_preparation_apply",
        matchId: audit.matchId,
        evidenceReference: audit.evidence,
        verificationReason: audit.reason,
        outcome: rejected ? "rejected" : "failed",
      });
    }
    if (audit && applyStarted && !rejected && !failed) clearChallenge = false;
    response = adminLineupError(error, { operation: "apply", matchId });
  }
  if (clearChallenge) {
    response.cookies.set(ADMIN_LINEUP_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/lineup/apply",
      maxAge: 0,
    });
  }
  return response;
}
