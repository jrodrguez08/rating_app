import type { NextRequest } from "next/server";

import { AdminLifecycleService } from "@/lib/firebase/admin-lifecycle";
import { ADMIN_LIFECYCLE_ACTION_COOKIE } from "@/lib/server/admin-auth";
import {
  adminError,
  adminJson,
  parseAdminLifecycleAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminLifecycleAction(await request.json());
    const receipt = await new AdminLifecycleService().inspectAuthorized(
      { ...action, operatorId: identity.uid },
      request.cookies.get(ADMIN_LIFECYCLE_ACTION_COOKIE)?.value,
    );
    const response = adminJson({ receipt });
    if (!receipt.statusCheckAvailable) {
      response.cookies.set(ADMIN_LIFECYCLE_ACTION_COOKIE, "", {
        httpOnly: true,
        sameSite: "strict",
        path: "/api/admin/lifecycle",
        maxAge: 0,
      });
    }
    return response;
  } catch (error) {
    return adminError(error);
  }
}
