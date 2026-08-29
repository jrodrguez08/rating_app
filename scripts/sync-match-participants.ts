import { syncMatchParticipants } from "../src/application/sync-match-participants";
import { ApiFootballAdapter } from "../src/lib/providers/api-football/adapter";
import { EmulatorFootballSyncStore } from "./lib/emulator-firestore";

async function main() {
  const matchId = process.argv[2];
  if (matchId === undefined || matchId.trim() === "") {
    throw new Error(
      "A persisted match ID is required: npm run sync:match-participants -- <match-id>",
    );
  }
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey)
    throw new Error("API_FOOTBALL_KEY is required. See .env.example.");

  const store = new EmulatorFootballSyncStore();
  const provider = new ApiFootballAdapter(apiKey, fetch, console.log);
  const summary = await syncMatchParticipants(matchId, provider, store);

  console.log(
    `Fixture ${summary.externalFixtureId}: ${summary.starters} starters, ${summary.substitutes} substitutes, ${summary.participated} participated, ${summary.unusedSubstitutes} unused`,
  );
  console.log(
    `Players: ${formatCounts(summary.players)}; participants: ${formatCounts(summary.participants)}`,
  );
  console.log(
    `Head coach: ${summary.coach.name}; coaches: ${formatCounts(summary.coaches)}; assignments: ${formatCounts(summary.coachAssignments)}`,
  );
  console.log(`API requests: ${summary.apiRequests}`);
}

function formatCounts(counts: {
  created: number;
  updated: number;
  unchanged: number;
}) {
  return `${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged`;
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Participant sync failed.",
  );
  process.exitCode = 1;
});
