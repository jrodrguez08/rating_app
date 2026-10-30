import { selectPublicMatch } from "@/application/public-match-selection";
import type { Match } from "@/domain/models";

import { AdminFootballSyncStore } from "./server";

export async function getPublicHomeMatch(
  teamId: string,
  now = new Date(),
): Promise<Match | null> {
  const matches = await new AdminFootballSyncStore().listMatches(teamId);
  return selectPublicMatch(matches, now) ?? null;
}
