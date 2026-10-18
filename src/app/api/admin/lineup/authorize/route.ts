import type { NextRequest } from "next/server";

import { getMessages } from "@/i18n/messages";
import {
  AdminSecurityError,
  AdminSecurityStore,
} from "@/lib/firebase/admin-security";
import {
  ADMIN_LINEUP_ACTION_COOKIE,
  readAdminIdentityConfig,
} from "@/lib/server/admin-auth";
import {
  adminError,
  adminJson,
  parseAdminLineupAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

const messages = getMessages("es").admin;

export async function POST(request: NextRequest) {
  const security = new AdminSecurityStore();
  let audit: { uid: string; matchId: string } | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new Error("Invalid request.");
    }
    const action = parseAdminLineupAction(
      "action" in body ? body.action : undefined,
    );
    audit = { uid: identity.uid, matchId: action.matchId };
    const previewToken = "previewToken" in body ? body.previewToken : undefined;
    const passphrase = "passphrase" in body ? body.passphrase : undefined;
    if (typeof previewToken !== "string" || typeof passphrase !== "string") {
      throw new Error("Invalid request.");
    }
    const challenge = await security.authorizeAction({
      operatorUid: identity.uid,
      action,
      previewToken,
      passphrase,
    });
    await security.audit({
      operatorUid: identity.uid,
      action: "lineup_preparation_passphrase",
      matchId: action.matchId,
      outcome: "success",
    });
    const response = adminJson({
      authorized: true,
      expiresAt: challenge.expiresAt,
    });
    response.cookies.set(ADMIN_LINEUP_ACTION_COOKIE, challenge.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: readAdminIdentityConfig().secureCookies,
      path: "/api/admin/lineup/apply",
      maxAge: 120,
    });
    return response;
  } catch (error) {
    if (audit) {
      await security.audit({
        operatorUid: audit.uid,
        action: "lineup_preparation_passphrase",
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
