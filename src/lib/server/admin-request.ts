import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getMessages } from "@/i18n/messages";
import { emitOperationalLog } from "@/lib/operational-log";
import type { AdminCoachAction } from "@/lib/server/admin-coach-action";
import type { AdminLifecycleAction } from "@/lib/server/admin-lifecycle-action";
import type { AdminManualVotingAction } from "@/lib/server/admin-manual-voting-action";
import type { AdminLineupDraftAction } from "@/lib/server/admin-lineup-draft-action";
import type { AdminPlayerIdentityAction } from "@/lib/server/admin-player-identity-action";
import type {
  AdminLineupAction,
  AdminLineupParticipantAction,
} from "@/lib/server/admin-lineup-action";
import {
  AdminLineupError,
  type AdminLineupErrorCode,
  InternalPlayerIdentityConfigurationError,
} from "@/lib/server/admin-lineup-error";
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
    throw new AdminLineupError(
      "LINEUP_INVALID_INPUT",
      "Lineup request input is invalid.",
    );
  }
  const required = [
    "matchId",
    "trackedTeamId",
    "externalFixtureId",
    "verificationSource",
    "verificationReason",
  ] as const;
  for (const key of required) {
    if (typeof value[key] !== "string") {
      throw new AdminLineupError(
        "LINEUP_INVALID_INPUT",
        "Lineup request input is invalid.",
      );
    }
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

export function parseAdminLineupDraftAction(
  value: unknown,
): AdminLineupDraftAction {
  if (!isRecord(value) || !Array.isArray(value.participants)) {
    throw new AdminAuthorizationError(403);
  }
  for (const key of [
    "matchId",
    "trackedTeamId",
    "externalFixtureId",
  ] as const) {
    if (typeof value[key] !== "string") throw new AdminAuthorizationError(403);
  }
  if (!Number.isInteger(value.baseVersion) || Number(value.baseVersion) < 0) {
    throw new AdminAuthorizationError(403);
  }
  return {
    matchId: value.matchId as string,
    trackedTeamId: value.trackedTeamId as string,
    externalFixtureId: value.externalFixtureId as string,
    baseVersion: Number(value.baseVersion),
    participants: value.participants.map((participant) => {
      const parsed = parseLineupParticipant(participant);
      if (!parsed.playerName) throw new AdminAuthorizationError(403);
      return { ...parsed, playerName: parsed.playerName };
    }),
  };
}

export function parseAdminLifecycleAction(
  value: unknown,
): AdminLifecycleAction {
  if (!isRecord(value)) throw new AdminAuthorizationError(403);
  for (const key of [
    "matchId",
    "trackedTeamId",
    "externalFixtureId",
  ] as const) {
    if (typeof value[key] !== "string") throw new AdminAuthorizationError(403);
  }
  return {
    matchId: value.matchId as string,
    trackedTeamId: value.trackedTeamId as string,
    externalFixtureId: value.externalFixtureId as string,
  };
}

export function parseAdminManualVotingAction(
  value: unknown,
): AdminManualVotingAction {
  if (!isRecord(value)) throw new AdminAuthorizationError(403);
  for (const key of [
    "matchId",
    "trackedTeamId",
    "externalFixtureId",
    "verificationSource",
    "verificationReason",
    "closeMode",
  ] as const) {
    if (typeof value[key] !== "string") throw new AdminAuthorizationError(403);
  }
  if (
    value.finalWhistleConfirmed !== true ||
    !["default", "custom"].includes(String(value.closeMode)) ||
    (value.closeMode === "custom" &&
      typeof value.customClosesAtLocal !== "string") ||
    (value.customClosesAtLocal !== undefined &&
      typeof value.customClosesAtLocal !== "string")
  ) {
    throw new AdminAuthorizationError(403);
  }
  return value as unknown as AdminManualVotingAction;
}

export function parseAdminPlayerIdentityAction(
  value: unknown,
): AdminPlayerIdentityAction {
  if (!isRecord(value)) throw new AdminAuthorizationError(403);
  for (const key of [
    "canonicalPlayerId",
    "trackedTeamId",
    "externalProvider",
    "externalProviderPlayerId",
    "decision",
    "verificationSource",
    "verificationReason",
  ] as const) {
    if (typeof value[key] !== "string") throw new AdminAuthorizationError(403);
  }
  if (
    value.externalProvider !== "api-football" ||
    !["match", "nonmatch"].includes(String(value.decision))
  ) {
    throw new AdminAuthorizationError(403);
  }
  return value as unknown as AdminPlayerIdentityAction;
}

function parseLineupParticipant(value: unknown): AdminLineupParticipantAction {
  if (
    !isRecord(value) ||
    typeof value.playerId !== "string" ||
    typeof value.createInternalIdentity !== "boolean" ||
    (value.identityAllocationToken !== undefined &&
      typeof value.identityAllocationToken !== "string") ||
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
    throw new AdminLineupError(
      "LINEUP_INVALID_INPUT",
      "Lineup participant input is invalid.",
    );
  }
  return {
    playerId: value.playerId,
    ...(value.playerName === undefined ? {} : { playerName: value.playerName }),
    createInternalIdentity: value.createInternalIdentity,
    ...(value.identityAllocationToken === undefined
      ? {}
      : { identityAllocationToken: value.identityAllocationToken }),
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
    if (value.includes("invalid or expired")) {
      return adminJson({ error: messages.customCloseError }, 400);
    }
    if (value.includes("team or fixture")) {
      return adminJson({ error: messages.bindingError }, 409);
    }
    if (value.includes("not permitted")) {
      return adminJson({ error: messages.matchStateError }, 409);
    }
    if (value.includes("stale lineup draft")) {
      return adminJson({ error: messages.draftStaleError }, 409);
    }
    if (value.includes("rate limit")) {
      return adminJson({ error: messages.lifecycleRateLimitError }, 429);
    }
    if (value.includes("canonical match")) {
      return adminJson({ error: messages.lifecycleTargetError }, 409);
    }
    if (value.includes("conflict")) {
      return adminJson({ error: messages.coachConflictError }, 409);
    }
  }
  return adminJson({ error: messages.operationError }, 400);
}

export function adminLineupError(
  error: unknown,
  context: {
    operation: "preview" | "authorize" | "apply" | "allocate" | "recover";
    matchId?: string;
  },
): NextResponse {
  if (error instanceof AdminAuthorizationError) return adminError(error);
  const requestId = randomUUID();
  const lineupError =
    error instanceof AdminLineupError
      ? error
      : error instanceof InternalPlayerIdentityConfigurationError
        ? new AdminLineupError(
            "LINEUP_INTERNAL_IDENTITY_CONFIGURATION_ERROR",
            error.message,
          )
        : new AdminLineupError(
            "LINEUP_PREVIEW_UNAVAILABLE",
            "Unexpected lineup operation failure.",
          );
  const status = lineupErrorStatus(lineupError.code);
  emitOperationalLog(
    status >= 500 ? console.error : console.warn,
    "admin_lineup_operation_failed",
    {
      requestId,
      operation: context.operation,
      code: lineupError.code,
      status,
      matchId: safeLogIdentifier(context.matchId),
    },
  );
  const response = adminJson(
    {
      error: lineupErrorMessage(lineupError, requestId),
      code: lineupError.code,
      requestId,
    },
    status,
  );
  response.headers.set("X-Request-ID", requestId);
  return response;
}

function lineupErrorStatus(code: AdminLineupErrorCode): number {
  if (code === "LINEUP_INVALID_INPUT") return 400;
  if (code === "LINEUP_MATCH_NOT_FOUND") return 404;
  if (code === "LINEUP_PLAYER_NOT_FOUND") return 404;
  if (code === "LINEUP_INTERNAL_IDENTITY_CONFIGURATION_ERROR") return 503;
  if (code === "LINEUP_PREVIEW_UNAVAILABLE") return 500;
  return 409;
}

function lineupErrorMessage(error: AdminLineupError, requestId: string) {
  const values = messages.lineupErrors;
  const player = error.participantName ?? "el jugador seleccionado";
  const byCode: Record<AdminLineupErrorCode, string> = {
    LINEUP_INVALID_INPUT: values.invalidInput,
    LINEUP_MATCH_NOT_FOUND: values.matchNotFound,
    LINEUP_INVALID_MATCH_STATE: values.invalidMatchState,
    LINEUP_INVALID_TEAM_BINDING: values.invalidTeamBinding,
    LINEUP_TRACKED_TEAM_PROVIDER_ID_MISSING:
      values.trackedTeamProviderIdMissing,
    LINEUP_PLAYER_NOT_FOUND: values.playerNotFound.replace("{player}", player),
    LINEUP_PLAYER_NAME_CONFLICT: values.playerNameConflict.replace(
      "{player}",
      player,
    ),
    LINEUP_PLAYER_MEMBERSHIP_CONFLICT: values.playerMembershipConflict.replace(
      "{player}",
      player,
    ),
    LINEUP_PLAYER_ALIAS_CONFLICT: values.playerAliasConflict.replace(
      "{player}",
      player,
    ),
    LINEUP_INTERNAL_IDENTITY_INVALID: values.internalIdentityInvalid,
    LINEUP_INTERNAL_IDENTITY_CONFIGURATION_ERROR:
      values.internalIdentityConfiguration,
    LINEUP_DRAFT_STALE: values.draftStale,
    LINEUP_PREVIEW_UNAVAILABLE: values.previewUnavailable.replace(
      "{requestId}",
      requestId,
    ),
  };
  return byCode[error.code];
}

function safeLogIdentifier(value: string | undefined): string | null {
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
