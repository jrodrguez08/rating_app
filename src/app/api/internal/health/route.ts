import { initialClub } from "@/config/club";
import { AdminFootballSyncStore } from "@/lib/firebase/server";
import { isAuthorizedCronRequest } from "@/lib/server/cron-auth";
import { requireLifecycleRuntimeConfig } from "@/lib/server/environment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return json({ status: "unauthorized" }, 401);
  }
  try {
    requireLifecycleRuntimeConfig();
    await new AdminFootballSyncStore().getTeam(initialClub.teamId);
    return json({ status: "ready" });
  } catch {
    console.error("Internal readiness check failed.");
    return json({ status: "not_ready" }, 503);
  }
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
