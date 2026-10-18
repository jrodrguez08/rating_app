import { randomUUID } from "node:crypto";

import { runMatchLifecycle } from "@/application/match-lifecycle";
import { syncFootballData } from "@/application/sync-football";
import { syncMatchParticipants } from "@/application/sync-match-participants";
import {
  notifyVotingWindowOpenedIfPending,
  type VotingWindowNotifier,
} from "@/application/voting-window-notification";
import type {
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
  options: { trigger?: "scheduled" | "operator" } = {},
) {
  const logs: string[] = [];
  const log = (message: string) => {
    logs.push(message);
    console.info(message);
  };
  const attemptId = randomUUID();
  const trigger = options.trigger ?? "scheduled";
  if (
    store.claimLifecycleExecution &&
    !(await store.claimLifecycleExecution(teamId, attemptId, trigger))
  ) {
    log("lifecycle.execution outcome=skipped reason=execution-in-progress");
    return {
      action: "idle" as const,
      providerRequests: 0,
      reason: "A lifecycle execution is already in progress.",
      logs,
    };
  }
  const provider = new ApiFootballAdapter(apiKey, fetch, log);
  let result;
  try {
    result = await runMatchLifecycle({
      teamId,
      provider,
      store,
      now,
      discoverFixtures: async (team, currentTime) => {
        await syncFootballData(team, provider, store, { now: currentTime });
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
    ...(notificationOutcome === undefined
      ? {}
      : { notification: notificationOutcome }),
    logs,
  };
}
