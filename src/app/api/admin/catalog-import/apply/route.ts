import type { NextRequest } from "next/server";

import {
  AdminCatalogImportRejectedError,
  AdminCatalogImportService,
} from "@/lib/firebase/admin-catalog-import";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { ADMIN_CATALOG_ACTION_COOKIE } from "@/lib/server/admin-auth";
import { parseAdminCatalogAction } from "@/lib/server/admin-catalog-action";
import {
  adminError,
  adminJson,
  requireAdminActionClub,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  const security = new AdminSecurityStore();
  let response;
  let clearChallenge = true;
  let applyStarted = false;
  let audit: { uid: string; teamId: string } | undefined;
  try {
    const owner = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("action" in body) ||
      !("confirmed" in body) ||
      body.confirmed !== true
    ) {
      return adminJson(
        { error: "Confirme la importación antes de continuar." },
        400,
      );
    }
    const action = parseAdminCatalogAction(body.action);
    requireAdminActionClub(request, action.trackedTeamId);
    audit = { uid: owner.uid, teamId: action.trackedTeamId };
    applyStarted = true;
    const result = await new AdminCatalogImportService().applyAuthorized(
      action,
      owner.uid,
      request.cookies.get(ADMIN_CATALOG_ACTION_COOKIE)?.value,
    );
    response = adminJson(result);
  } catch (error) {
    if (audit && !applyStarted) {
      await security.audit({
        operatorUid: audit.uid,
        action: "catalog_import_apply",
        resourceId: audit.teamId,
        outcome: "rejected",
      });
    }
    if (
      audit &&
      applyStarted &&
      !(error instanceof AdminCatalogImportRejectedError)
    )
      clearChallenge = false;
    response =
      error instanceof AdminCatalogImportRejectedError
        ? adminJson({ error: error.message, code: error.code }, 409)
        : adminError(error);
  }
  if (clearChallenge)
    response.cookies.set(ADMIN_CATALOG_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/catalog-import/apply",
      maxAge: 0,
    });
  return response;
}
