import { runMatchLifecycle } from "@/application/match-lifecycle";
import { syncFootballData } from "@/application/sync-football";
import { syncMatchParticipants } from "@/application/sync-match-participants";
import type { MatchLifecycleStore } from "@/domain/ports";
import { ApiFootballAdapter } from "@/lib/providers/api-football/adapter";

export function runConfiguredLifecycle(
  teamId: string,
  store: MatchLifecycleStore,
  apiKey: string,
  now: () => Date = () => new Date(),
) {
  const logs: string[] = [];
  const log = (message: string) => {
    logs.push(message);
    console.info(message);
  };
  const provider = new ApiFootballAdapter(apiKey, fetch, log);
  return runMatchLifecycle({
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
  }).then((result) => ({ ...result, logs }));
}
