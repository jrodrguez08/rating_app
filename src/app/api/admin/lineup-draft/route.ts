import type { NextRequest } from "next/server";

import { AdminLineupDraftService } from "@/lib/firebase/admin-lineup-draft";
import {
  adminError,
  adminJson,
  parseAdminLineupDraftAction,
  requireAdminRequest,
  requireAdminActionClub,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminLineupDraftAction(await request.json());
    requireAdminActionClub(request, action.trackedTeamId);
    const result = await new AdminLineupDraftService().save({
      ...action,
      ownerId: identity.uid,
    });
    return adminJson({ saved: true, ...result });
  } catch (error) {
    return adminError(error);
  }
}
