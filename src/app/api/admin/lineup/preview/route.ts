import type { NextRequest } from "next/server";

import { AdminVerifiedLineupService } from "@/lib/firebase/admin-lineup";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import {
  adminJson,
  adminLineupError,
  parseAdminLineupAction,
  requireAdminRequest,
  requireAdminActionClub,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  let matchId: string | undefined;
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminLineupAction(await request.json());
    requireAdminActionClub(request, action.trackedTeamId);
    matchId = action.matchId;
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
