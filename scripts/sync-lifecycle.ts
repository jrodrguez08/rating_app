import { runConfiguredLifecycle } from "../src/application/run-lifecycle";
import { initialClub } from "../src/config/club";
import { EmulatorFootballSyncStore } from "./lib/emulator-firestore";

async function main() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey)
    throw new Error("API_FOOTBALL_KEY is required. See .env.example.");
  const store = new EmulatorFootballSyncStore();
  const result = await runConfiguredLifecycle(
    initialClub.teamId,
    store,
    apiKey,
  );
  const match =
    result.matchId === undefined ? null : await store.getMatch(result.matchId);
  console.log(
    JSON.stringify({
      ...result,
      ...(match === null
        ? {}
        : {
            fixtureId: match.externalProviderFixtureId,
            kickoffAt: match.kickoffAt,
            homeTeam: match.homeTeam.name,
            awayTeam: match.awayTeam.name,
            status: match.status,
            ratingState: match.ratingState,
            score: match.score,
          }),
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Lifecycle sync failed.",
  );
  process.exitCode = 1;
});
