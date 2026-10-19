import type { NextRequest } from "next/server";

import { AdminCoachIdentityService } from "@/lib/firebase/admin-coach-identity";
import {
  adminError,
  adminJson,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    return adminJson(await new AdminCoachIdentityService().suggestions());
  } catch (error) {
    return adminError(error);
  }
}
