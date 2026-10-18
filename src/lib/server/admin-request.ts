import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMessages } from "@/i18n/messages";
import type { AdminCoachAction } from "@/lib/server/admin-coach-action";
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  AdminAuthorizationError,
  requireAdminCsrf,
  requireAdminOrigin,
  verifyAdminSession,
} from "@/lib/server/admin-auth";

const messages = getMessages("es").admin;

export async function requireAdminRequest(
  request: NextRequest,
  mutation = false,
): Promise<{ uid: string }> {
  if (mutation) {
    requireAdminOrigin(request.headers.get("origin"));
    requireAdminCsrf(
      request.headers.get("x-admin-csrf"),
      request.cookies.get(ADMIN_CSRF_COOKIE)?.value,
    );
  }
  return verifyAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}

export function parseAdminCoachAction(value: unknown): AdminCoachAction {
  if (!isRecord(value)) throw new AdminAuthorizationError(403);
  const required = [
    "matchId",
    "trackedTeamId",
    "externalFixtureId",
    "coachId",
    "coachName",
    "verificationSource",
    "verificationReason",
  ] as const;
  for (const key of required) {
    if (typeof value[key] !== "string") throw new AdminAuthorizationError(403);
  }
  if (
    value.externalProviderCoachId !== undefined &&
    typeof value.externalProviderCoachId !== "string"
  ) {
    throw new AdminAuthorizationError(403);
  }
  return {
    matchId: value.matchId as string,
    trackedTeamId: value.trackedTeamId as string,
    externalFixtureId: value.externalFixtureId as string,
    coachId: value.coachId as string,
    coachName: value.coachName as string,
    ...(value.externalProviderCoachId
      ? { externalProviderCoachId: value.externalProviderCoachId as string }
      : {}),
    verificationSource: value.verificationSource as string,
    verificationReason: value.verificationReason as string,
  };
}

export function adminJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function adminError(error: unknown): NextResponse {
  if (error instanceof AdminAuthorizationError) {
    return adminJson({ error: messages.authorizationError }, error.status);
  }
  if (error instanceof Error) {
    const value = error.message.toLowerCase();
    if (value.includes("match was not found")) {
      return adminJson({ error: messages.matchMissingError }, 404);
    }
    if (
      value.includes("input is invalid") ||
      value.includes("provider identity mapping")
    ) {
      return adminJson({ error: messages.inputError }, 400);
    }
    if (value.includes("team or fixture")) {
      return adminJson({ error: messages.bindingError }, 409);
    }
    if (value.includes("not permitted")) {
      return adminJson({ error: messages.matchStateError }, 409);
    }
    if (value.includes("conflict")) {
      return adminJson({ error: messages.coachConflictError }, 409);
    }
  }
  return adminJson({ error: messages.operationError }, 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
