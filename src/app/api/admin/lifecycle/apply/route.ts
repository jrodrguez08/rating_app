import type { NextRequest } from "next/server";

import { runConfiguredLifecycle } from "@/application/run-lifecycle";
import { initialClub } from "@/config/club";
import {
  AdminLifecycleService,
  type AdminLifecycleInput,
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
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const service = new AdminLifecycleService();
  const challengeToken = request.cookies.get(
    ADMIN_LIFECYCLE_ACTION_COOKIE,
  )?.value;
  let input: AdminLifecycleInput | undefined;
  let requestAttemptId: string | undefined;
  let disposition: "committed" | "idempotent_retry" | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      throw new Error("Invalid request.");
    }
    const action = parseAdminLifecycleAction(
      "action" in body ? body.action : undefined,
    );
    const confirmation = "confirmation" in body ? body.confirmation : undefined;
    if (confirmation !== `request-lifecycle:${action.matchId}`) {
      throw new Error(
        "Lifecycle confirmation does not match the selected match.",
      );
    }
    if (action.trackedTeamId !== initialClub.teamId) {
      throw new Error("Invalid team.");
    }
    const apiKey = requireLifecycleRuntimeConfig().apiFootballKey;
    input = { ...action, operatorId: identity.uid };
    const commit = await service.applyAuthorized(input, challengeToken);
    disposition = commit.disposition;
    const claim = await service.claimExecution(input, challengeToken);
    if (!claim.execute) {
      return receiptResponse(commit.disposition, claim.receipt);
    }
    requestAttemptId = claim.requestAttemptId;
    const notificationConfig = readResendNotificationConfig();
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
      { trigger: "operator", attemptId: requestAttemptId },
    );
    const receipt = await service.recordExecutionOutcome(
      input,
      challengeToken,
      requestAttemptId,
      result,
    );
    return receiptResponse(commit.disposition, receipt);
  } catch (error) {
    if (input && requestAttemptId) {
      try {
        const receipt = await service.recordExecutionFailure(
          input,
          challengeToken,
          requestAttemptId,
        );
        return receiptResponse(disposition ?? "idempotent_retry", receipt);
      } catch {
        // Preserve the original error if durable recovery cannot be recorded.
      }
    }
    return adminError(error);
  }
}

function receiptResponse(
  disposition: "committed" | "idempotent_retry",
  receipt: Awaited<ReturnType<AdminLifecycleService["inspectAuthorized"]>>,
) {
  const response = adminJson({ accepted: true, disposition, receipt });
  if (!receipt.statusCheckAvailable) {
    response.cookies.set(ADMIN_LIFECYCLE_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/lifecycle",
      maxAge: 0,
    });
  }
  return response;
}
