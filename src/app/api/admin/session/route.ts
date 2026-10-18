import { randomBytes } from "node:crypto";

import type { NextRequest } from "next/server";

import { getServerAuth } from "@/lib/firebase/server";
import { getMessages } from "@/i18n/messages";
import {
  ADMIN_ACTION_COOKIE,
  ADMIN_CSRF_COOKIE,
  ADMIN_LINEUP_ACTION_COOKIE,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_MS,
  authenticateAdminIdToken,
  readAdminIdentityConfig,
  requireAdminOrigin,
} from "@/lib/server/admin-auth";
import { adminError, adminJson } from "@/lib/server/admin-request";

const messages = getMessages("es").admin;

export async function POST(request: NextRequest) {
  try {
    requireAdminOrigin(request.headers.get("origin"));
    const body: unknown = await request.json();
    const idToken =
      typeof body === "object" && body !== null && "idToken" in body
        ? body.idToken
        : undefined;
    if (typeof idToken !== "string" || idToken.length > 10_000) {
      return adminJson({ error: messages.credentialsError }, 400);
    }
    await authenticateAdminIdToken(idToken);
    const session = await getServerAuth().createSessionCookie(idToken, {
      expiresIn: ADMIN_SESSION_MAX_AGE_MS,
    });
    const csrf = randomBytes(32).toString("base64url");
    const { secureCookies } = readAdminIdentityConfig();
    const response = adminJson({ authenticated: true });
    response.cookies.set(ADMIN_SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookies,
      path: "/",
      maxAge: ADMIN_SESSION_MAX_AGE_MS / 1000,
    });
    response.cookies.set(ADMIN_CSRF_COOKIE, csrf, {
      httpOnly: false,
      sameSite: "strict",
      secure: secureCookies,
      path: "/",
      maxAge: ADMIN_SESSION_MAX_AGE_MS / 1000,
    });
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
