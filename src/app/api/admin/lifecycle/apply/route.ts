import type { NextRequest } from "next/server";

import { runConfiguredLifecycle } from "@/application/run-lifecycle";
import { initialClub } from "@/config/club";
import {
  AdminLifecycleRejectedError,
  AdminLifecycleService,
} from "@/lib/firebase/admin-lifecycle";
import {
  AdminFootballSyncStore,
  AdminVotingWindowNotificationStore,
} from "@/lib/firebase/server";
import {
  readNotificationSiteUrl,
  readResendNotificationConfig,
  ResendVotingWindowNotifier,
} from "@/lib/notifications/resend";
import { ADMIN_LIFECYCLE_ACTION_COOKIE } from "@/lib/server/admin-auth";
import {
  adminError,
  adminJson,
  parseAdminLifecycleAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";
import { requireLifecycleRuntimeConfig } from "@/lib/server/environment";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let response;
  let clearChallenge = true;
  try {
    const identity = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null)
      throw new Error("Invalid request.");
    const action = parseAdminLifecycleAction(
      "action" in body ? body.action : undefined,
    );
    const confirmation = "confirmation" in body ? body.confirmation : undefined;
    if (confirmation !== `request-lifecycle:${action.matchId}`) {
      throw new Error(
        "Lifecycle confirmation does not match the selected match.",
      );
    }
    const apiKey = requireLifecycleRuntimeConfig().apiFootballKey;
    const notificationConfig = readResendNotificationConfig();
    const commit = await new AdminLifecycleService().applyAuthorized(
      { ...action, operatorId: identity.uid },
      request.cookies.get(ADMIN_LIFECYCLE_ACTION_COOKIE)?.value,
    );
    if (commit.disposition === "idempotent_retry") {
      response = adminJson({ accepted: true, ...commit });
    } else {
      const result = await runConfiguredLifecycle(
        initialClub.teamId,
        new AdminFootballSyncStore(),
        apiKey,
        undefined,
        {
          store: new AdminVotingWindowNotificationStore(),
          notifier:
            notificationConfig === null
              ? null
              : new ResendVotingWindowNotifier(notificationConfig),
          siteUrl: readNotificationSiteUrl(),
        },
        { trigger: "operator" },
      );
      response = adminJson({
        accepted: true,
        ...commit,
        lifecycle: {
          action: result.action,
          ...(result.matchId ? { matchId: result.matchId } : {}),
          providerRequests: result.providerRequests,
        },
      });
    }
  } catch (error) {
    if (!(error instanceof AdminLifecycleRejectedError)) clearChallenge = false;
    response = adminError(error);
  }
  if (clearChallenge) {
    response.cookies.set(ADMIN_LIFECYCLE_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/lifecycle/apply",
      maxAge: 0,
    });
  }
  return response;
}
