import type { NextRequest } from "next/server";

import { initialClub } from "@/config/club";
import { AdminVerifiedLineupService } from "@/lib/firebase/admin-lineup";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import {
  adminError,
  adminJson,
  parseAdminLineupAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminLineupAction(await request.json());
    if (action.trackedTeamId !== initialClub.teamId) {
      throw new Error("Invalid team.");
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
    return adminError(error);
  }
}
