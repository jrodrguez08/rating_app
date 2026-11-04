import type { NextRequest } from "next/server";

import { getMessages } from "@/i18n/messages";
import {
  AdminCatalogImportRejectedError,
  AdminCatalogImportService,
} from "@/lib/firebase/admin-catalog-import";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { ApiFootballAdapter } from "@/lib/providers/api-football/adapter";
import { ProviderError } from "@/lib/providers/api-football/errors";
import { emitOperationalLog } from "@/lib/operational-log";
import {
  adminError,
  adminJson,
  requireAdminActionClub,
  requireAdminRequest,
} from "@/lib/server/admin-request";
import { requireApiFootballRuntimeConfig } from "@/lib/server/environment";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let provider: ApiFootballAdapter | undefined;
  let selectedTeamId: string | undefined;
  try {
    const owner = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    const teamId =
      typeof body === "object" && body !== null && "trackedTeamId" in body
        ? body.trackedTeamId
        : undefined;
    if (typeof teamId !== "string")
      throw new AdminCatalogImportRejectedError(
        "invalid_input",
        "Seleccione un club válido.",
      );
    requireAdminActionClub(request, teamId);
    selectedTeamId = teamId;
    const { apiFootballKey } = requireApiFootballRuntimeConfig();
    provider = new ApiFootballAdapter(apiFootballKey, fetch, (entry) =>
      console.info(entry),
    );
    const { action, plan } = await new AdminCatalogImportService().preview(
      teamId,
      owner.uid,
      provider,
    );
    const preview = await new AdminSecurityStore().issuePreview(
      owner.uid,
      action,
    );
    emitOperationalLog(console.info, "admin.catalog_import_preview", {
      teamId,
      status: "ready",
      providerRequests: provider.requestCount,
      playerCount: plan.playerCount,
      coachCount: plan.coachCount,
    });
    return adminJson({
      action,
      plan,
      previewToken: preview.token,
      expiresAt: preview.expiresAt,
    });
  } catch (error) {
    if (selectedTeamId)
      emitOperationalLog(console.warn, "admin.catalog_import_preview", {
        teamId: selectedTeamId,
        status: "failed",
        code:
          error instanceof ProviderError
            ? error.code
            : error instanceof AdminCatalogImportRejectedError
              ? error.code
              : "unexpected",
        providerRequests: provider?.requestCount ?? 0,
      });
    return adminCatalogError(error);
  }
}

function adminCatalogError(error: unknown) {
  if (error instanceof ProviderError) {
    const messages = getMessages("es").admin.catalogImport;
    const status =
      error.code === "rate-limited"
        ? 429
        : error.code === "malformed-response"
          ? 502
          : 503;
    return adminJson(
      {
        error:
          error.code === "rate-limited"
            ? messages.quotaError
            : error.code === "malformed-response"
              ? messages.malformedError
              : messages.providerError,
        code: error.code,
      },
      status,
    );
  }
  if (error instanceof AdminCatalogImportRejectedError) {
    const status =
      error.code === "rate_limited"
        ? 429
        : error.code === "invalid_input"
          ? 400
          : 409;
    return adminJson({ error: error.message, code: error.code }, status);
  }
  return adminError(error);
}
