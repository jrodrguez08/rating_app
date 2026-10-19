import type { NextRequest } from "next/server";

import { initialClub } from "@/config/club";
import { generateInternalPlayerId } from "@/domain/player-identity";
import { getServerFirestore } from "@/lib/firebase/server";
import {
  issueInternalPlayerAllocationToken,
  type InternalPlayerAllocation,
} from "@/lib/server/admin-player-identity-allocation";
import { AdminLineupError } from "@/lib/server/admin-lineup-error";
import {
  adminLineupError,
  adminJson,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  let matchId: string | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("matchId" in body) ||
      typeof body.matchId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(body.matchId) ||
      !("trackedTeamId" in body) ||
      body.trackedTeamId !== initialClub.teamId
    ) {
      throw new AdminLineupError(
        "LINEUP_INVALID_INPUT",
        "Internal Player allocation input is invalid.",
      );
    }
    matchId = body.matchId;
    const database = getServerFirestore();
    const match = await database.doc(`matches/${body.matchId}`).get();
    if (!match.exists) {
      throw new AdminLineupError("LINEUP_MATCH_NOT_FOUND", "Match not found.");
    }
    const data = match.data();
    if (
      data?.trackedTeamId !== initialClub.teamId ||
      !["not_ready", "preparing_rating"].includes(String(data.ratingState))
    ) {
      throw new AdminLineupError(
        "LINEUP_INVALID_MATCH_STATE",
        "Internal Player allocation is not permitted.",
      );
    }
    let playerId = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = generateInternalPlayerId();
      if (!(await database.doc(`players/${candidate}`).get()).exists) {
        playerId = candidate;
        break;
      }
    }
    if (!playerId) {
      throw new AdminLineupError(
        "LINEUP_INTERNAL_IDENTITY_INVALID",
        "Internal Player allocation failed.",
      );
    }
    const allocation: InternalPlayerAllocation = {
      playerId,
      ownerId: identity.uid,
      matchId: body.matchId,
      trackedTeamId: initialClub.teamId,
    };
    return adminJson({
      playerId,
      identityAllocationToken: issueInternalPlayerAllocationToken(allocation),
    });
  } catch (error) {
    return adminLineupError(error, { operation: "allocate", matchId });
  }
}
