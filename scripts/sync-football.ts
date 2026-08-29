import initialTeam from "../firebase/seed/initial-team.json";
import { syncFootballData } from "../src/application/sync-football";
import { ApiFootballAdapter } from "../src/lib/providers/api-football/adapter";
import { EmulatorFootballSyncStore } from "./lib/emulator-firestore";

async function main() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey)
    throw new Error("API_FOOTBALL_KEY is required. See .env.example.");

  const store = new EmulatorFootballSyncStore();
  const team = await store.getTeam(initialTeam.id);
  const provider = new ApiFootballAdapter(apiKey, fetch, console.log);
  const summary = await syncFootballData(team, provider, store);

  console.log(`Team: ${summary.team.id} -> ${summary.team.externalProviderId}`);
  console.log(
    `Competitions: ${summary.competitions.created} created, ${summary.competitions.updated} updated, ${summary.competitions.unchanged} unchanged`,
  );
  console.log(
    `Seasons: ${summary.seasons.created} created, ${summary.seasons.updated} updated, ${summary.seasons.unchanged} unchanged`,
  );
  console.log(
    `Matches: ${summary.matches.created} created, ${summary.matches.updated} updated, ${summary.matches.unchanged} unchanged`,
  );
  console.log(
    `Fixture window: ${summary.window.from} through ${summary.window.to}; ${summary.fixtureCount} fixtures; ${summary.apiRequests} API requests`,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Football sync failed.",
  );
  process.exitCode = 1;
});
