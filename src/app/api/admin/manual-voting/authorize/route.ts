import type { NextRequest } from "next/server";

import { getMessages } from "@/i18n/messages";
import {
  AdminSecurityError,
  AdminSecurityStore,
} from "@/lib/firebase/admin-security";
import {
  ADMIN_MANUAL_VOTING_ACTION_COOKIE,
  readAdminIdentityConfig,
} from "@/lib/server/admin-auth";
import {
  adminError,
  adminJson,
  parseAdminManualVotingAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

const messages = getMessages("es").admin;

export async function POST(request: NextRequest) {
  const security = new AdminSecurityStore();
  let audit: { uid: string; matchId: string } | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error();
    const action = parseAdminManualVotingAction(
      "action" in body ? body.action : undefined,
    );
    audit = { uid: identity.uid, matchId: action.matchId };
    const previewToken = "previewToken" in body ? body.previewToken : undefined;
    const passphrase = "passphrase" in body ? body.passphrase : undefined;
    if (typeof previewToken !== "string" || typeof passphrase !== "string")
      throw new Error();
    const challenge = await security.authorizeAction({
      operatorUid: identity.uid,
      action,
      previewToken,
      passphrase,
    });
    await security.audit({
      operatorUid: identity.uid,
      action: "manual_voting_passphrase",
      matchId: action.matchId,
      outcome: "success",
    });
    const response = adminJson({ authorized: true });
    response.cookies.set(ADMIN_MANUAL_VOTING_ACTION_COOKIE, challenge.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: readAdminIdentityConfig().secureCookies,
      path: "/api/admin/manual-voting/apply",
      maxAge: 120,
    });
    return response;
  } catch (error) {
    if (audit) {
      await security.audit({
        operatorUid: audit.uid,
        action: "manual_voting_passphrase",
        matchId: audit.matchId,
        outcome: "rejected",
      });
    }
    if (error instanceof AdminSecurityError) {
      return adminJson(
        {
          error:
            error.code === "too_many_attempts"
              ? messages.attemptsError
              : messages.passphraseError,
        },
        error.code === "too_many_attempts" ? 429 : 403,
      );
    }
    return adminError(error);
  }
}
