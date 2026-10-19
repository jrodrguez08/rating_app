import type { NextRequest } from "next/server";

import { initialClub } from "@/config/club";
import { AdminVerifiedLineupService } from "@/lib/firebase/admin-lineup";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { AdminLineupError } from "@/lib/server/admin-lineup-error";
import {
  adminJson,
  adminLineupError,
  parseAdminLineupAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  let matchId: string | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminLineupAction(await request.json());
    matchId = action.matchId;
    if (action.trackedTeamId !== initialClub.teamId) {
      throw new AdminLineupError(
        "LINEUP_INVALID_TEAM_BINDING",
        "Invalid configured Team.",
      );
    }
    const plan = await new AdminVerifiedLineupService().preview({
      ...action,
      operatorId: identity.uid,
    });
    const preview = await new AdminSecurityStore().issuePreview(
      identity.uid,
      action,
    );
    return adminJson({
      plan,
      previewToken: preview.token,
      expiresAt: preview.expiresAt,
    });
  } catch (error) {
    return adminLineupError(error, { operation: "preview", matchId });
  }
}
