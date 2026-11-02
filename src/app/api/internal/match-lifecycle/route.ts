import { runConfiguredLifecycle } from "@/application/run-lifecycle";
import { scheduledClubFromRequest } from "@/config/club-operations";
import {
  AdminFootballSyncStore,
  AdminVotingWindowNotificationStore,
} from "@/lib/firebase/server";
import {
  readNotificationSiteUrl,
  readResendNotificationConfig,
  ResendVotingWindowNotifier,
} from "@/lib/notifications/resend";
import { isAuthorizedCronRequest } from "@/lib/server/cron-auth";
import { requireLifecycleRuntimeConfig } from "@/lib/server/environment";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const target = scheduledClubFromRequest(request);
  if (target.status === "invalid") return json({ error: "Invalid club." }, 400);
  if (target.status === "disabled") {
    return json({
      action: "disabled",
      club: target.club.slug,
      providerRequests: 0,
    });
  }
  let apiKey: string;
  try {
    apiKey = requireLifecycleRuntimeConfig().apiFootballKey;
  } catch {
    console.error("Lifecycle configuration validation failed.");
    return json({ error: "Lifecycle synchronization is not configured." }, 503);
  }

  try {
    const notificationConfig = readResendNotificationConfig();
    const result = await runConfiguredLifecycle(
      target.club.teamId,
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
    );
    if (
      result.action === "retryable_error" ||
      result.action === "preparing_rating"
    ) {
      console.error("Lifecycle run requires retry.", {
        action: result.action,
        club: target.club.slug,
        matchId: result.matchId,
        providerRequests: result.providerRequests,
        ...(result.action === "preparing_rating" && result.reason
          ? { reason: result.reason }
          : {}),
      });
    }
    const safeResult = {
      action: result.action,
      club: target.club.slug,
      ...(result.matchId ? { matchId: result.matchId } : {}),
      providerRequests: result.providerRequests,
      logs: result.logs,
      ...(result.notification === undefined
        ? {}
        : { notification: result.notification }),
      ...(result.action === "preparing_rating" && result.reason
        ? { reason: result.reason }
        : {}),
    };
    return json(safeResult, result.action === "retryable_error" ? 503 : 200);
  } catch {
    console.error("Lifecycle synchronization failed before completion.");
    return json({ action: "retryable_error" }, 500);
  }
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
