import type { NextRequest } from "next/server";

import { AdminPlayerIdentityService } from "@/lib/firebase/admin-player-identity";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import {
  adminError,
  adminJson,
  parseAdminPlayerIdentityAction,
  requireAdminRequest,
  requireAdminActionClub,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminPlayerIdentityAction(await request.json());
    requireAdminActionClub(request, action.trackedTeamId);
    const plan = await new AdminPlayerIdentityService().preview({
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
