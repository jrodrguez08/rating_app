import { initialClub } from "@/config/club";
import { getServerFirestore } from "@/lib/firebase/server";
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
  } catch {
    console.error("Production health configuration check failed.");
    return notReady("configuration");
  }

  let teamExists: boolean;
  try {
    const snapshot = await getServerFirestore()
      .doc(`teams/${initialClub.teamId}`)
      .get();
    teamExists = snapshot.exists;
  } catch {
    console.error("Production health Firebase Admin check failed.");
    return notReady("firebase_admin");
  }

  if (!teamExists) {
    console.error("Production health canonical Team is missing.");
    return notReady("team_missing");
  }

  return json({ status: "ready" });
}

function notReady(reason: "configuration" | "firebase_admin" | "team_missing") {
  return json({ status: "not_ready", reason }, 503);
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
