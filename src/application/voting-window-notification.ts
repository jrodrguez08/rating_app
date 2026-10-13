import { randomUUID } from "node:crypto";

import type {
  VotingWindowNotificationClaim,
  VotingWindowNotificationContext,
  VotingWindowNotificationStore,
} from "@/domain/ports";
import {
  emitOperationalLog,
  type OperationalLogger,
} from "@/lib/operational-log";

export interface VotingWindowNotificationMessage extends VotingWindowNotificationContext {
  idempotencyKey: string;
  ratingUrl?: string;
}

export interface VotingWindowNotifier {
  send(message: VotingWindowNotificationMessage): Promise<{
    providerMessageId: string;
  }>;
}

export type VotingWindowNotificationOutcome =
  | "sent"
  | "already_sent"
  | "in_flight"
  | "not_open"
  | "not_configured"
  | "failed"
  | "manual_review";

export async function notifyVotingWindowOpenedIfPending({
  matchId,
  store,
  notifier,
  siteUrl,
  now = () => new Date(),
  log = () => undefined,
  attemptId = randomUUID(),
}: {
  matchId: string;
  store: VotingWindowNotificationStore;
  notifier: VotingWindowNotifier | null;
  siteUrl?: URL;
  now?: () => Date;
  log?: OperationalLogger;
  attemptId?: string;
}): Promise<VotingWindowNotificationOutcome> {
  let claim: VotingWindowNotificationClaim;
  try {
    claim = await store.claimVotingWindowNotification(
      matchId,
      attemptId,
      now(),
    );
  } catch {
    emitOperationalLog(log, "voting.notification", {
      matchId,
      windowSequence: "unknown",
      status: "failed",
      reason: "claim-failed",
    });
    return "failed";
  }
  if (claim.status !== "claimed") {
    emitOperationalLog(log, "voting.notification", {
      matchId,
      windowSequence: claim.windowSequence ?? "unknown",
      status: claim.status,
    });
    return claim.status;
  }

  const { context } = claim;
  if (notifier === null) {
    try {
      await store.releaseVotingWindowNotification(
        matchId,
        context.windowSequence,
        attemptId,
        true,
      );
    } catch {
      // The lease expires, so a later lifecycle pass can recover.
    }
    emitOperationalLog(log, "voting.notification", {
      matchId,
      windowSequence: context.windowSequence,
      status: "not_configured",
    });
    return "not_configured";
  }

  emitOperationalLog(log, "voting.notification", {
    matchId,
    windowSequence: context.windowSequence,
    status: "attempted",
  });
  try {
    const delivered = await notifier.send({
      ...context,
      idempotencyKey: notificationIdempotencyKey(
        matchId,
        context.windowSequence,
      ),
      ...(siteUrl === undefined
        ? {}
        : { ratingUrl: new URL(`/matches/${matchId}/rate`, siteUrl).href }),
    });
    let recorded = false;
    try {
      recorded = await store.markVotingWindowNotificationSent(
        matchId,
        context.windowSequence,
        attemptId,
        delivered.providerMessageId,
        now(),
      );
    } catch {
      emitOperationalLog(log, "voting.notification", {
        matchId,
        windowSequence: context.windowSequence,
        status: "failed",
        reason: "receipt-persistence-failed",
      });
      return "failed";
    }
    emitOperationalLog(log, "voting.notification", {
      matchId,
      windowSequence: context.windowSequence,
      status: recorded ? "sent" : "superseded",
    });
    return recorded ? "sent" : "in_flight";
  } catch {
    try {
      await store.releaseVotingWindowNotification(
        matchId,
        context.windowSequence,
        attemptId,
        false,
      );
    } catch {
      // The lease expires, so a later lifecycle pass can recover.
    }
    emitOperationalLog(log, "voting.notification", {
      matchId,
      windowSequence: context.windowSequence,
      status: "failed",
      reason: "delivery-failed",
    });
    return "failed";
  }
}

export function notificationIdempotencyKey(
  matchId: string,
  windowSequence: number,
): string {
  return `voting-open/${matchId}/${windowSequence}`;
}
