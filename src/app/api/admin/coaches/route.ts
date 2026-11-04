import type { NextRequest } from "next/server";

import { AdminConsoleService } from "@/lib/firebase/admin-console";
import {
  CoachSearchIndexIncompleteError,
  CoachSearchInvalidInputError,
  type CoachSearchScope,
} from "@/lib/firebase/coach-search-index";
import {
  adminError,
  adminJson,
  requireAdminClub,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const club = requireAdminClub(request);
    const parameters = request.nextUrl.searchParams;
    const matchId = parameters.get("matchId");
    const externalFixtureId = parameters.get("fixtureId");
    const scope = parameters.get("scope") ?? "team";
    if (
      !matchId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(matchId) ||
      !externalFixtureId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(externalFixtureId) ||
      !["team", "unassociated"].includes(scope) ||
      parameters.getAll("matchId").length !== 1 ||
      parameters.getAll("fixtureId").length !== 1 ||
      parameters.getAll("scope").length > 1 ||
      parameters.getAll("query").length > 1 ||
      parameters.getAll("cursor").length > 1
    ) {
      return adminJson(
        { error: "La búsqueda de directores técnicos no es válida." },
        400,
      );
    }
    const page = await new AdminConsoleService().searchCoaches(
      matchId,
      club.teamId,
      externalFixtureId,
      scope as CoachSearchScope,
      parameters.get("query") ?? "",
      parameters.get("cursor") ?? undefined,
    );
    if (!page)
      return adminJson(
        { error: "El partido no corresponde al club seleccionado." },
        404,
      );
    return adminJson(page);
  } catch (error) {
    if (error instanceof CoachSearchInvalidInputError) {
      return adminJson(
        { error: "La búsqueda de directores técnicos no es válida." },
        400,
      );
    }
    if (error instanceof CoachSearchIndexIncompleteError) {
      return adminJson(
        { error: "El catálogo de directores técnicos aún no está preparado." },
        503,
      );
    }
    return adminError(error);
  }
}
