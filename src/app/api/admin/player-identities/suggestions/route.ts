import type { NextRequest } from "next/server";

import { initialClub } from "@/config/club";
import { AdminPlayerIdentityService } from "@/lib/firebase/admin-player-identity";
import {
  adminError,
  adminJson,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const result = await new AdminPlayerIdentityService().suggestions(
      initialClub.teamId,
    );
    return adminJson(result);
  } catch (error) {
    return adminError(error);
  }
}
