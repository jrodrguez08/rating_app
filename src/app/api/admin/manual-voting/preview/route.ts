import type { NextRequest } from "next/server";

import { AdminManualVotingService } from "@/lib/firebase/admin-manual-voting";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import {
  adminError,
  adminJson,
  parseAdminManualVotingAction,
  requireAdminRequest,
  requireAdminActionClub,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminManualVotingAction(await request.json());
    requireAdminActionClub(request, action.trackedTeamId);
    const plan = await new AdminManualVotingService().preview({
      ...action,
      operatorId: identity.uid,
    });
    const preview = await new AdminSecurityStore().issuePreview(
      identity.uid,
      action,
    );
    return adminJson({ plan, previewToken: preview.token });
  } catch (error) {
    return adminError(error);
  }
}
