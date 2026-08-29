import { initialClub } from "@/config/club";
import { runConfiguredLifecycle } from "@/application/run-lifecycle";
import { AdminFootballSyncStore } from "@/lib/firebase/server";
import { isAuthorizedCronRequest } from "@/lib/server/cron-auth";
import { requireLifecycleRuntimeConfig } from "@/lib/server/environment";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  let apiKey: string;
  try {
    apiKey = requireLifecycleRuntimeConfig().apiFootballKey;
  } catch {
    console.error("Lifecycle configuration validation failed.");
    return json({ error: "Lifecycle synchronization is not configured." }, 503);
  }

  try {
    const result = await runConfiguredLifecycle(
      initialClub.teamId,
      new AdminFootballSyncStore(),
      apiKey,
    );
    if (
      result.action === "retryable_error" ||
      result.action === "preparing_rating"
    ) {
      console.error("Lifecycle run requires retry.", {
        action: result.action,
        matchId: result.matchId,
        providerRequests: result.providerRequests,
      });
    }
    const safeResult = {
      action: result.action,
      ...(result.matchId ? { matchId: result.matchId } : {}),
      providerRequests: result.providerRequests,
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
