import type { NextRequest } from "next/server";

import { getServerAuth } from "@/lib/firebase/server";
import {
  ADMIN_ACTION_COOKIE,
  ADMIN_CSRF_COOKIE,
  ADMIN_LINEUP_ACTION_COOKIE,
  ADMIN_SESSION_COOKIE,
} from "@/lib/server/admin-auth";
import {
  adminError,
  adminJson,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    await getServerAuth().revokeRefreshTokens(identity.uid);
    const response = adminJson({ authenticated: false });
    response.cookies.delete(ADMIN_SESSION_COOKIE);
    response.cookies.delete(ADMIN_CSRF_COOKIE);
    response.cookies.set(ADMIN_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/coach-assignment/apply",
      maxAge: 0,
    });
    response.cookies.set(ADMIN_LINEUP_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/lineup/apply",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return adminError(error);
  }
}
