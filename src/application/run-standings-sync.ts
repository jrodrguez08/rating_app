import { syncStandings } from "@/application/sync-standings";
import type { StandingsSyncStore } from "@/domain/ports";
import { ApiFootballAdapter } from "@/lib/providers/api-football/adapter";

export function runConfiguredStandingsSync(
  teamId: string,
  store: StandingsSyncStore,
  apiKey: string,
  now: () => Date = () => new Date(),
) {
  const logs: string[] = [];
  const log = (message: string) => {
    logs.push(message);
    console.info(message);
  };
  const provider = new ApiFootballAdapter(apiKey, fetch, log);
  return syncStandings(teamId, provider, store, now(), log).then((result) => ({
    ...result,
    logs,
  }));
}
