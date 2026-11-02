import { clubs } from "@/config/club";
import { isScheduledClubEnabled, publicClub } from "@/config/club-operations";
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

  try {
    const database = getServerFirestore();
    const herediano = await database
      .doc(`teams/${clubs.herediano.teamId}`)
      .get();
    if (!herediano.exists) return notReady("team_missing");
    const heredianoMetadata = await database
      .doc(`footballSyncMetadata/${clubs.herediano.teamId}`)
      .get();
    const heredianoStatus =
      heredianoMetadata.data?.()?.lastLifecycleAction === "retryable_error"
        ? "operational_failure"
        : "ready";

    const saprissaFlag = process.env.SAPRISSA_SCHEDULED_ENABLED;
    if (
      saprissaFlag !== undefined &&
      saprissaFlag !== "true" &&
      saprissaFlag !== "false"
    ) {
      return json(
        {
          status: "not_ready",
          reason: "configuration",
          clubs: {
            herediano: heredianoStatus,
            saprissa: "invalid_configuration",
          },
        },
        503,
      );
    }
    if (!isScheduledClubEnabled("saprissa")) {
      return json(
        {
          status: heredianoStatus === "ready" ? "ready" : "not_ready",
          clubs: {
            herediano: heredianoStatus,
            saprissa: "disabled",
          },
          public: {
            herediano: true,
            saprissa: publicClub("saprissa").publicAvailability === "active",
          },
        },
        heredianoStatus === "ready" ? 200 : 503,
      );
    }
    const saprissa = await database.doc(`teams/${clubs.saprissa.teamId}`).get();
    if (!saprissa.exists || !saprissa.data()?.externalProviderId) {
      return json(
        {
          status: "not_ready",
          reason: "team_missing",
          clubs: { herediano: heredianoStatus, saprissa: "bootstrap_required" },
        },
        503,
      );
    }
    const metadata = await database
      .doc(`footballSyncMetadata/${clubs.saprissa.teamId}`)
      .get();
    const action = metadata.data()?.lastLifecycleAction;
    const matchId = metadata.data()?.lastLifecycleMatchId;
    let saprissaStatus = "no_relevant_fixture";
    if (action === "retryable_error") {
      saprissaStatus = "operational_failure";
    } else if (typeof matchId === "string" && matchId !== "") {
      const match = await database.doc(`matches/${matchId}`).get();
      if (
        match.exists &&
        match.data()?.trackedTeamId === clubs.saprissa.teamId
      ) {
        if (match.data()?.ratingState === "preparing_rating") {
          saprissaStatus = "awaiting_evidence";
        } else if (
          match.data()?.ratingState === "rating_ready" ||
          match.data()?.status === "scheduled" ||
          match.data()?.status === "live"
        ) {
          saprissaStatus = "ready";
        }
      }
    }
    return json(
      {
        status:
          saprissaStatus === "operational_failure" ||
          heredianoStatus === "operational_failure"
            ? "not_ready"
            : "ready",
        clubs: { herediano: heredianoStatus, saprissa: saprissaStatus },
        public: {
          herediano: true,
          saprissa: publicClub("saprissa").publicAvailability === "active",
        },
      },
      saprissaStatus === "operational_failure" ||
        heredianoStatus === "operational_failure"
        ? 503
        : 200,
    );
  } catch {
    console.error("Production health Firebase Admin check failed.");
    return notReady("firebase_admin");
  }
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
