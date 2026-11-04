import type { NextRequest } from "next/server";

import { AdminCoachIdentityService } from "@/lib/firebase/admin-coach-identity";
import {
  CoachSearchIndexIncompleteError,
  CoachSearchInvalidInputError,
} from "@/lib/firebase/coach-search-index";
import {
  adminError,
  adminJson,
  requireAdminRequest,
  requireAdminClub,
} from "@/lib/server/admin-request";

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const club = requireAdminClub(request);
    const query = request.nextUrl.searchParams.get("query") ?? "";
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    if (query.length > 80 || (cursor && cursor.length > 512)) {
      return adminJson({ coaches: [] }, 400);
    }
    return adminJson(
      await new AdminCoachIdentityService().search(club.teamId, query, cursor),
    );
  } catch (error) {
    if (error instanceof CoachSearchInvalidInputError) {
      return adminJson({ coaches: [] }, 400);
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
