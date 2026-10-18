import type { NextRequest } from "next/server";

import { AdminConsoleService } from "@/lib/firebase/admin-console";
import {
  adminError,
  adminJson,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const query = request.nextUrl.searchParams.get("query") ?? "";
    if (query.length > 80) return adminJson({ players: [] }, 400);
    const players = await new AdminConsoleService().searchPlayers(query);
    return adminJson({ players });
  } catch (error) {
    return adminError(error);
  }
}
