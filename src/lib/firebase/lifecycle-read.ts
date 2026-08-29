import { selectRelevantMatch } from "@/application/match-lifecycle";
import type { Match } from "@/domain/models";

import { AdminFootballSyncStore } from "./server";

export async function getLifecycleHomeMatch(
  teamId: string,
  now = new Date(),
): Promise<Match | null> {
  const matches = await new AdminFootballSyncStore().listMatches(teamId);
  return selectRelevantMatch(matches, now) ?? null;
}
