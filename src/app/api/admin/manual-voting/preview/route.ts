import type { NextRequest } from "next/server";

import { initialClub } from "@/config/club";
import { AdminManualVotingService } from "@/lib/firebase/admin-manual-voting";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import {
  adminError,
  adminJson,
  parseAdminManualVotingAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminManualVotingAction(await request.json());
    if (action.trackedTeamId !== initialClub.teamId)
      throw new Error("Invalid team.");
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
