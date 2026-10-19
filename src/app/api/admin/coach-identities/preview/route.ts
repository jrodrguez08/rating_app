import type { NextRequest } from "next/server";

import {
  AdminCoachIdentityRejectedError,
  AdminCoachIdentityService,
} from "@/lib/firebase/admin-coach-identity";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import {
  adminError,
  adminJson,
  parseAdminCoachIdentityAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    const action = parseAdminCoachIdentityAction(await request.json());
    const plan = await new AdminCoachIdentityService().preview({
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
    return error instanceof AdminCoachIdentityRejectedError
      ? adminJson({ error: error.message }, 409)
      : adminError(error);
  }
}
