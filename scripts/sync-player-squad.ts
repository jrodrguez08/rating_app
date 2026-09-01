import { pathToFileURL } from "node:url";

import initialTeam from "../firebase/seed/initial-team.json";
import { syncPlayerSquad } from "../src/application/sync-player-squad";
import { AdminFootballSyncStore } from "../src/lib/firebase/server";
import { ApiFootballAdapter } from "../src/lib/providers/api-football/adapter";
import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";

const CONFIRMATION = "sync-player-squad";

export function parsePlayerSquadSyncArguments(arguments_: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) throw usageError();
    values.set(key, value);
  }
  const projectId = values.get("--project-id");
  if (
    !projectId ||
    values.get("--confirm") !== CONFIRMATION ||
    values.size !== 2
  ) {
    throw usageError();
  }
  return { projectId };
}

export async function main() {
  const arguments_ = parsePlayerSquadSyncArguments(process.argv.slice(2));
  const config = readFirebaseAdminRuntimeConfig();
  if (config.projectId !== arguments_.projectId) {
    throw new Error("The confirmed project ID does not match Firebase Admin.");
  }
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error("API_FOOTBALL_KEY is required.");
  const summary = await syncPlayerSquad(
    initialTeam.id,
    new ApiFootballAdapter(apiKey),
    new AdminFootballSyncStore(),
  );
  console.log(
    `Squad sync complete for teams/${summary.teamId}: ${summary.players.created} created, ${summary.players.updated} updated, ${summary.players.unchanged} unchanged; ${summary.apiRequests} provider request.`,
  );
}

function usageError() {
  return new Error(
    "Usage: npm run sync:player-squad -- --project-id <exact-project> --confirm sync-player-squad",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error("Player squad sync failed.");
    process.exitCode = 1;
  });
}
