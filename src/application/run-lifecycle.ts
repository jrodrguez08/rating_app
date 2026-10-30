import { randomUUID } from "node:crypto";

import { runMatchLifecycle } from "@/application/match-lifecycle";
import { syncFootballData } from "@/application/sync-football";
import { syncMatchParticipants } from "@/application/sync-match-participants";
import {
  notifyVotingWindowOpenedIfPending,
  type VotingWindowNotifier,
} from "@/application/voting-window-notification";
import type {
  LifecycleExecutionClaim,
  MatchLifecycleStore,
  VotingWindowNotificationStore,
} from "@/domain/ports";
import { ApiFootballAdapter } from "@/lib/providers/api-football/adapter";

export async function runConfiguredLifecycle(
  teamId: string,
  store: MatchLifecycleStore,
  apiKey: string,
  now: () => Date = () => new Date(),
  notification?: {
    store: VotingWindowNotificationStore;
    notifier: VotingWindowNotifier | null;
    siteUrl?: URL;
  },
  options: {
    trigger?: "scheduled" | "operator";
    attemptId?: string;
  } = {},
) {
  const logs: string[] = [];
  const log = (message: string) => {
    logs.push(message);
    console.info(message);
  };
  const attemptId = options.attemptId ?? randomUUID();
  const trigger = options.trigger ?? "scheduled";
  const claim: LifecycleExecutionClaim = store.claimLifecycleExecution
    ? await store.claimLifecycleExecution(teamId, attemptId, trigger)
    : { status: "claimed", leaseUntil: new Date(0).toISOString() };
  if (claim.status === "busy") {
    log("lifecycle.execution outcome=skipped reason=execution-in-progress");
    return {
      action: "idle" as const,
      executionStatus: "skipped_busy" as const,
      providerRequests: 0,
      reason: "A lifecycle execution is already in progress.",
      activeExecution: claim,
      matchId: claim.matchId,
      notification: undefined,
      logs,
    };
  }
  const provider = new ApiFootballAdapter(
    apiKey,
    lifecycleFetch(store, teamId, attemptId),
    log,
  );
  let result;
  try {
    result = await runMatchLifecycle({
      teamId,
      provider,
      store,
      now,
      discoverFixtures: async (team, currentTime) => {
        return syncFootballData(team, provider, store, { now: currentTime });
      },
      syncParticipants: async (matchId, currentTime, phase) => {
        return syncMatchParticipants(
          matchId,
          provider,
          store,
          currentTime,
          phase,
          log,
        );
      },
      log,
    });
  } catch (error) {
    await store.completeLifecycleExecution?.(teamId, attemptId, {
      action: "retryable_error",
      providerRequests: provider.requestCount,
    });
    throw error;
  }
  await store.completeLifecycleExecution?.(teamId, attemptId, result);
  const notificationOutcome =
    result.matchId === undefined || notification === undefined
      ? undefined
      : await notifyVotingWindowOpenedIfPending({
          matchId: result.matchId,
          store: notification.store,
          notifier: notification.notifier,
          siteUrl: notification.siteUrl,
          now,
          log,
        });
  return {
    ...result,
    executionStatus:
      result.action === "retryable_error"
        ? ("failed" as const)
        : ("completed" as const),
    executionAttemptId: attemptId,
    ...(notificationOutcome === undefined
      ? {}
      : { notification: notificationOutcome }),
    logs,
  };
}

function lifecycleFetch(
  store: MatchLifecycleStore,
  teamId: string,
  attemptId: string,
): typeof fetch {
  return async (input, init) => {
    if (
      store.renewLifecycleExecution &&
      !(await store.renewLifecycleExecution(teamId, attemptId))
    ) {
      throw new Error("Lifecycle execution lease was lost.");
    }
    const timeout = AbortSignal.timeout(10_000);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    return fetch(input, { ...init, signal });
  };
}
