import type { NextRequest } from "next/server";

import { WrappedSnapshotError } from "@/application/wrapped-snapshot";
import { WrappedStatisticsError } from "@/application/wrapped-statistics-input";
import { getMessages } from "@/i18n/messages";
import {
  AdminSecurityError,
  AdminSecurityStore,
} from "@/lib/firebase/admin-security";
import { AdminWrappedService } from "@/lib/firebase/admin-wrapped";
import { getServerFirestore } from "@/lib/firebase/server";
import { readAdminIdentityConfig } from "@/lib/server/admin-auth";
import {
  adminError,
  adminJson,
  requireAdminClub,
  requireAdminRequest,
} from "@/lib/server/admin-request";
import {
  adminWrappedResourceId,
  wrappedConfirmation,
  type AdminWrappedAction,
} from "@/lib/server/admin-wrapped-action";
import { wrappedLocalEnabled } from "@/lib/server/wrapped-local";

const COOKIE = "rating_admin_wrapped_action";
const messages = getMessages("es").admin;

export async function POST(request: NextRequest) {
  try {
    if (!wrappedLocalEnabled()) return adminJson({ code: "unavailable" }, 404);
    const { uid } = await requireAdminRequest(request, true);
    const club = requireAdminClub(request);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 256_000)
      throw new WrappedSnapshotError("oversized_evidence");
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new WrappedSnapshotError("invalid_input");
    const {
      step,
      operation,
      tournamentKey,
      ledger,
      digest,
      epoch,
      confirmation,
      previewToken,
      passphrase,
    } = body as Record<string, unknown>;
    if (
      (operation !== "approve" && operation !== "withdraw") ||
      typeof tournamentKey !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}:[0-9]{4}:(?:apertura|clausura)$/.test(
        tournamentKey,
      )
    )
      throw new WrappedSnapshotError("invalid_input");
    const scope = {
      wrappedOperation: operation,
      trackedTeamId: club.teamId,
      tournamentKey,
    } as const;
    const database = getServerFirestore();
    const service = new AdminWrappedService(database);
    const security = new AdminSecurityStore(database);
    if (step === "preview") {
      const preview = await service.preview(scope, ledger);
      return adminJson({
        ...preview,
        confirmation: wrappedConfirmation(preview.action),
        preview: await security.issuePreview(uid, preview.action),
      });
    }
    if (
      typeof digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      typeof epoch !== "number" ||
      !Number.isSafeInteger(epoch) ||
      epoch < 0
    )
      throw new WrappedSnapshotError("invalid_input");
    const action: AdminWrappedAction = { ...scope, digest, epoch };
    if (confirmation !== wrappedConfirmation(action))
      throw new WrappedSnapshotError("invalid_input");
    if (
      step === "authorize" &&
      typeof previewToken === "string" &&
      typeof passphrase === "string"
    ) {
      const challenge = await security.authorizeAction({
        operatorUid: uid,
        action,
        previewToken,
        passphrase,
      });
      await security.audit({
        operatorUid: uid,
        action: "wrapped_passphrase",
        resourceId: adminWrappedResourceId(action),
        outcome: "success",
      });
      const response = adminJson({
        authorized: true,
        expiresAt: challenge.expiresAt,
      });
      response.cookies.set(COOKIE, challenge.token, {
        httpOnly: true,
        sameSite: "strict",
        secure: readAdminIdentityConfig().secureCookies,
        path: "/api/admin/wrapped",
        maxAge: 120,
      });
      return response;
    }
    if (step === "apply") {
      return adminJson(
        await service.applyAuthorized(
          action,
          uid,
          request.cookies.get(COOKIE)?.value,
          ledger,
        ),
      );
    }
    throw new WrappedSnapshotError("invalid_input");
  } catch (error) {
    if (error instanceof WrappedSnapshotError)
      return adminJson(
        { code: error.code },
        error.code === "unavailable"
          ? 404
          : error.code === "invalid_input"
            ? 400
            : 409,
      );
    if (error instanceof WrappedStatisticsError)
      return adminJson({ code: error.code }, 409);
    if (error instanceof AdminSecurityError)
      return adminJson(
        { code: error.code },
        error.code === "too_many_attempts" ? 429 : 403,
      );
    if (error instanceof SyntaxError)
      return adminJson({ code: "invalid_input" }, 400);
    const response = adminError(error);
    return response.status !== 400
      ? response
      : adminJson({ error: messages.operationError }, 500);
  }
}
