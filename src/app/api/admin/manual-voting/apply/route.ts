import type { NextRequest } from "next/server";

import { notifyVotingWindowOpenedIfPending } from "@/application/voting-window-notification";
import { initialClub } from "@/config/club";
import { AdminManualVotingService } from "@/lib/firebase/admin-manual-voting";
import { AdminVotingWindowNotificationStore } from "@/lib/firebase/server";
import {
  readNotificationSiteUrl,
  readResendNotificationConfig,
  ResendVotingWindowNotifier,
} from "@/lib/notifications/resend";
import { ADMIN_MANUAL_VOTING_ACTION_COOKIE } from "@/lib/server/admin-auth";
import {
  adminError,
  adminJson,
  parseAdminManualVotingAction,
  requireAdminRequest,
} from "@/lib/server/admin-request";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireAdminRequest(request, true);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) throw new Error();
    const action = parseAdminManualVotingAction(
      "action" in body ? body.action : undefined,
    );
    const confirmation = "confirmation" in body ? body.confirmation : undefined;
    if (confirmation !== `open-voting:${action.matchId}`)
      throw new Error("Manual voting confirmation is invalid.");
    if (action.trackedTeamId !== initialClub.teamId)
      throw new Error("Invalid team.");
    const result = await new AdminManualVotingService().applyAuthorized(
      { ...action, operatorId: identity.uid },
      request.cookies.get(ADMIN_MANUAL_VOTING_ACTION_COOKIE)?.value,
    );
    const notificationConfig = readResendNotificationConfig();
    await notifyVotingWindowOpenedIfPending({
      matchId: action.matchId,
      store: new AdminVotingWindowNotificationStore(),
      notifier:
        notificationConfig === null
          ? null
          : new ResendVotingWindowNotifier(notificationConfig),
      siteUrl: readNotificationSiteUrl(),
    });
    const response = adminJson({ applied: true, ...result });
    response.cookies.set(ADMIN_MANUAL_VOTING_ACTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/api/admin/manual-voting/apply",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return adminError(error);
  }
}
