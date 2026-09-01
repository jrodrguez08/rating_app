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
  const provider = new ApiFootballAdapter(apiKey);
  return runMatchLifecycle({
    teamId,
    provider,
    store,
    now,
    discoverFixtures: async (team, currentTime) => {
      await syncFootballData(team, provider, store, { now: currentTime });
    },
    syncParticipants: async (matchId, currentTime, phase) => {
      await syncMatchParticipants(matchId, provider, store, currentTime, phase);
    },
  });
}
