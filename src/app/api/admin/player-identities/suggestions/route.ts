import type { NextRequest } from "next/server";

import { AdminPlayerIdentityService } from "@/lib/firebase/admin-player-identity";
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
    const result = await new AdminPlayerIdentityService().suggestions(
      club.teamId,
    );
    return adminJson(result);
  } catch (error) {
    return adminError(error);
  }
}
