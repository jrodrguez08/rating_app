import type { NextRequest } from "next/server";

import { initialClub } from "@/config/club";
import {
  AdminProviderCheckRejectedError,
  AdminProviderCheckService,
} from "@/lib/firebase/admin-provider-check";
import { emitOperationalLog } from "@/lib/operational-log";
import { ApiFootballAdapter } from "@/lib/providers/api-football/adapter";
import {
  adminError,
  adminJson,
  requireAdminRequest,
} from "@/lib/server/admin-request";
import { requireApiFootballRuntimeConfig } from "@/lib/server/environment";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAction(await request.json());
    if (action.trackedTeamId !== initialClub.teamId) {
      throw new AdminProviderCheckRejectedError(
        "binding_conflict",
        "El equipo no coincide con la configuración de la aplicación.",
      );
    }
    const { apiFootballKey } = requireApiFootballRuntimeConfig();
    const provider = new ApiFootballAdapter(apiFootballKey, fetch, (entry) =>
      console.info(entry),
    );
    const report = await new AdminProviderCheckService(provider).check({
      ...action,
      operatorId: identity.uid,
    });
    emitOperationalLog(console.info, "admin.provider_check", {
      matchId: action.matchId,
      fixtureId: action.externalFixtureId,
      status: report.status,
      providerRequests: report.providerRequests,
    });
    return adminJson({ report });
  } catch (error) {
    if (error instanceof AdminProviderCheckRejectedError) {
      const status =
        error.code === "match_not_found"
          ? 404
          : error.code === "rate_limited"
            ? 429
            : error.code === "invalid_input"
              ? 400
              : 409;
      return adminJson({ error: error.message, code: error.code }, status);
    }
    return adminError(error);
  }
}

function parseAction(value: unknown): {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("matchId" in value) ||
    typeof value.matchId !== "string" ||
    !("trackedTeamId" in value) ||
    typeof value.trackedTeamId !== "string" ||
    !("externalFixtureId" in value) ||
    typeof value.externalFixtureId !== "string"
  ) {
    throw new AdminProviderCheckRejectedError(
      "invalid_input",
      "La solicitud de comprobación no es válida.",
    );
  }
  return {
    matchId: value.matchId,
    trackedTeamId: value.trackedTeamId,
    externalFixtureId: value.externalFixtureId,
  };
}
