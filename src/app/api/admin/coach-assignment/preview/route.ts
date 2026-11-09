import type { NextRequest } from "next/server";

import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { AdminVerifiedCoachService } from "@/lib/firebase/server";
import {
  adminCoachError,
  adminJson,
  parseAdminCoachAction,
  requireAdminRequest,
  requireAdminActionClub,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  const security = new AdminSecurityStore();
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminCoachAction(await request.json());
    requireAdminActionClub(request, action.trackedTeamId);
    const plan = await new AdminVerifiedCoachService().assign(
      { ...action, operatorId: identity.uid },
      false,
    );
    const boundAction = {
      ...action,
      coachIdentityVersion: plan.coachIdentityVersion,
    };
    const preview = await security.issuePreview(identity.uid, boundAction);
    return adminJson({
      plan,
      action: boundAction,
      previewToken: preview.token,
      expiresAt: preview.expiresAt,
    });
  } catch (error) {
    return adminCoachError(error, "preview");
  }
}
