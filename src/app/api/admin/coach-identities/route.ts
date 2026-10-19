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
    const query = request.nextUrl.searchParams.get("query") ?? "";
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    if (
      query.length > 80 ||
      (cursor && (cursor.length > 128 || cursor.includes("/")))
    ) {
      return adminJson({ coaches: [] }, 400);
    }
    return adminJson(
      await new AdminCoachIdentityService().search(query, cursor),
    );
  } catch (error) {
    return adminError(error);
  }
}
