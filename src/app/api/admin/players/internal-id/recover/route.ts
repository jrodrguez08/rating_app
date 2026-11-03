import type { NextRequest } from "next/server";

import { AdminPlayerIdentityRecoveryService } from "@/lib/firebase/admin-player-identity-recovery";
import { AdminLineupError } from "@/lib/server/admin-lineup-error";
import {
  adminJson,
  adminLineupError,
  requireAdminRequest,
  requireAdminClub,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  let matchId: string | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const club = requireAdminClub(request);
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("matchId" in body) ||
      typeof body.matchId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(body.matchId) ||
      !("trackedTeamId" in body) ||
      body.trackedTeamId !== club.teamId ||
      !("externalFixtureId" in body) ||
      typeof body.externalFixtureId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(body.externalFixtureId)
    ) {
      throw new AdminLineupError(
        "LINEUP_INVALID_INPUT",
        "Internal identity recovery input is invalid.",
      );
    }
    matchId = body.matchId;
    const result = await new AdminPlayerIdentityRecoveryService().recover({
      ownerId: identity.uid,
      matchId,
      trackedTeamId: club.teamId,
      externalFixtureId: body.externalFixtureId,
    });
    return adminJson(result);
  } catch (error) {
    return adminLineupError(error, { operation: "recover", matchId });
  }
}
