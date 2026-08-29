import { initialClub } from "@/config/club";
import { runConfiguredLifecycle } from "@/application/run-lifecycle";
import { AdminFootballSyncStore } from "@/lib/firebase/server";
import { isAuthorizedCronRequest } from "@/lib/server/cron-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return Response.json(
      { error: "Lifecycle synchronization is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await runConfiguredLifecycle(
      initialClub.teamId,
      new AdminFootballSyncStore(),
      apiKey,
    );
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        action: "retryable_error",
        reason:
          error instanceof Error
            ? error.message
            : "Lifecycle synchronization failed.",
      },
      { status: 500 },
    );
  }
}
