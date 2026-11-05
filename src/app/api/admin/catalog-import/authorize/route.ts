import type { NextRequest } from "next/server";

import { getMessages } from "@/i18n/messages";
import {
  AdminSecurityError,
  AdminSecurityStore,
} from "@/lib/firebase/admin-security";
import {
  ADMIN_CATALOG_ACTION_COOKIE,
  readAdminIdentityConfig,
} from "@/lib/server/admin-auth";
import { parseAdminCatalogAction } from "@/lib/server/admin-catalog-action";
import {
  adminError,
  adminJson,
  requireAdminActionClub,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  const security = new AdminSecurityStore();
  try {
    const owner = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("action" in body) ||
      !("previewToken" in body) ||
      !("passphrase" in body)
    ) {
      return adminJson({ error: "La solicitud no es válida." }, 400);
    }
    const action = parseAdminCatalogAction(body.action);
    requireAdminActionClub(request, action.trackedTeamId);
    if (
      typeof body.previewToken !== "string" ||
      typeof body.passphrase !== "string"
    ) {
      return adminJson({ error: "La solicitud no es válida." }, 400);
    }
    const challenge = await security.authorizeAction({
      operatorUid: owner.uid,
      action,
      previewToken: body.previewToken,
      passphrase: body.passphrase,
    });
    await security.audit({
      operatorUid: owner.uid,
      action: "catalog_import_passphrase",
      resourceId: action.trackedTeamId,
      outcome: "success",
    });
    const response = adminJson({
      authorized: true,
      expiresAt: challenge.expiresAt,
    });
    response.cookies.set(ADMIN_CATALOG_ACTION_COOKIE, challenge.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: readAdminIdentityConfig().secureCookies,
      path: "/api/admin/catalog-import/apply",
      maxAge: 120,
    });
    return response;
  } catch (error) {
    if (error instanceof AdminSecurityError) {
      const messages = getMessages("es").admin;
      return adminJson(
        {
          error:
            error.code === "too_many_attempts"
              ? messages.attemptsError
              : error.code === "stale_preview"
                ? messages.catalogImport.previewExpired
                : messages.catalogImport.passphraseInvalid,
          code: error.code,
        },
        error.code === "too_many_attempts" ? 429 : 403,
      );
    }
    return adminError(error);
  }
}
