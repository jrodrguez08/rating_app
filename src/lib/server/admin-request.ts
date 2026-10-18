import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMessages } from "@/i18n/messages";
import type { AdminCoachAction } from "@/lib/server/admin-coach-action";
import type {
  AdminLineupAction,
  AdminLineupParticipantAction,
} from "@/lib/server/admin-lineup-action";
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

export function parseAdminLineupAction(value: unknown): AdminLineupAction {
  if (!isRecord(value) || !Array.isArray(value.participants)) {
    throw new AdminAuthorizationError(403);
  }
  const required = [
    "matchId",
    "trackedTeamId",
    "externalFixtureId",
    "verificationSource",
    "verificationReason",
  ] as const;
  for (const key of required) {
    if (typeof value[key] !== "string") throw new AdminAuthorizationError(403);
  }
  return {
    matchId: value.matchId as string,
    trackedTeamId: value.trackedTeamId as string,
    externalFixtureId: value.externalFixtureId as string,
    participants: value.participants.map(parseLineupParticipant),
    verificationSource: value.verificationSource as string,
    verificationReason: value.verificationReason as string,
  };
}

function parseLineupParticipant(value: unknown): AdminLineupParticipantAction {
  if (
    !isRecord(value) ||
    typeof value.playerId !== "string" ||
    typeof value.createInternalIdentity !== "boolean" ||
    (value.playerName !== undefined && typeof value.playerName !== "string") ||
    !["starter", "substitute"].includes(String(value.squadRole)) ||
    ![
      "confirmed_starter",
      "confirmed_substitute",
      "unused_substitute",
      "unconfirmed",
    ].includes(String(value.participationStatus)) ||
    (value.shirtNumber !== undefined &&
      typeof value.shirtNumber !== "number") ||
    (value.position !== undefined &&
      !["goalkeeper", "defender", "midfielder", "attacker"].includes(
        String(value.position),
      )) ||
    (value.enteredAtMinute !== undefined &&
      typeof value.enteredAtMinute !== "number")
  ) {
    throw new AdminAuthorizationError(403);
  }
  return {
    playerId: value.playerId,
    ...(value.playerName === undefined ? {} : { playerName: value.playerName }),
    createInternalIdentity: value.createInternalIdentity,
    squadRole: value.squadRole as AdminLineupParticipantAction["squadRole"],
    participationStatus:
      value.participationStatus as AdminLineupParticipantAction["participationStatus"],
    ...(value.shirtNumber === undefined
      ? {}
      : { shirtNumber: value.shirtNumber }),
    ...(value.position === undefined
      ? {}
      : {
          position: value.position as AdminLineupParticipantAction["position"],
        }),
    ...(value.enteredAtMinute === undefined
      ? {}
      : { enteredAtMinute: value.enteredAtMinute }),
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
