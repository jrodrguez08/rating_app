import { runConfiguredStandingsSync } from "@/application/run-standings-sync";
import { initialClub } from "@/config/club";
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
    console.error("Standings configuration validation failed.");
    return json({ error: "Standings synchronization is not configured." }, 503);
  }
  try {
    const result = await runConfiguredStandingsSync(
      initialClub.teamId,
      new AdminFootballSyncStore(),
      apiKey,
    );
    const safeResult = {
      action: result.action,
      ...(result.competitionId ? { competitionId: result.competitionId } : {}),
      rows: result.rows,
      providerRequests: result.providerRequests,
      logs: result.logs,
      ...(result.reason ? { reason: result.reason } : {}),
    };
    return json(safeResult, result.action === "snapshot_preserved" ? 503 : 200);
  } catch {
    console.error("Standings synchronization failed before completion.");
    return json({ action: "snapshot_preserved" }, 500);
  }
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
