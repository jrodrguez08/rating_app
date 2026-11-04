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
    return adminJson(await new AdminConsoleService().overview(club.teamId));
  } catch (error) {
    return adminError(error);
  }
}
