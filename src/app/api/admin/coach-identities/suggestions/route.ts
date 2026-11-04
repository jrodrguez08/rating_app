import type { NextRequest } from "next/server";

import { AdminCoachIdentityService } from "@/lib/firebase/admin-coach-identity";
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
    return adminJson(
      await new AdminCoachIdentityService().suggestions(club.teamId),
    );
  } catch (error) {
    return adminError(error);
  }
}
