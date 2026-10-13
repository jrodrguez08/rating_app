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
) {
  const logs: string[] = [];
  const log = (message: string) => {
    logs.push(message);
    console.info(message);
  };
  const provider = new ApiFootballAdapter(apiKey, fetch, log);
  const result = await runMatchLifecycle({
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
      );
    },
    log,
  });
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
