import type { NextRequest } from "next/server";

import { AdminConsoleService } from "@/lib/firebase/admin-console";
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
    if (query.length > 80) return adminJson({ players: [] }, 400);
    if (cursor && (cursor.length > 200 || cursor.includes("/"))) {
      return adminJson({ players: [] }, 400);
    }
    const page = await new AdminConsoleService().searchPlayers(
      club.teamId,
      query,
      cursor,
    );
    return adminJson(page);
  } catch (error) {
    return adminError(error);
  }
}
