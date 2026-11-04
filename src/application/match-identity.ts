import { createHash } from "node:crypto";

import { initialClub } from "@/config/club";
import type { CoachAssignment, Match, MatchParticipant } from "@/domain/models";

/** Keep the original provider/fixture ID for every existing Herediano Match. */
export function trackedMatchId(
  provider: string,
  fixtureId: string,
  trackedTeamId: string,
): string {
  const identity =
    trackedTeamId === initialClub.teamId
      ? fixtureId
      : `${trackedTeamId}:${fixtureId}`;
  const digest = createHash("sha256")
    .update(`${provider}:match:${identity}`)
    .digest("hex")
    .slice(0, 24);
  return `match-${digest}`;
}

export function isMatchOwnedByTeam(match: Match, teamId: string): boolean {
  return (
    match.trackedTeamId === teamId &&
    (match.trackedTeamExternalProviderId === undefined ||
      match.trackedTeamExternalProviderId ===
        match.homeTeam.externalProviderId ||
      match.trackedTeamExternalProviderId === match.awayTeam.externalProviderId)
  );
}

export function isMatchContextOwnedByTeam(
  match: Match,
  context: Partial<
    Pick<
      MatchParticipant | CoachAssignment,
      "matchId" | "teamId" | "externalProviderTeamId"
    >
  >,
): boolean {
  return (
    context.matchId === match.id &&
    context.teamId === match.trackedTeamId &&
    (match.trackedTeamExternalProviderId === undefined ||
      context.externalProviderTeamId === match.trackedTeamExternalProviderId)
  );
}

export function assertSameTrackedFixture(
  existing: Match,
  incoming: Match,
): void {
  if (
    existing.id !== incoming.id ||
    existing.trackedTeamId !== incoming.trackedTeamId ||
    existing.externalProvider !== incoming.externalProvider ||
    existing.externalProviderFixtureId !== incoming.externalProviderFixtureId ||
    (existing.trackedTeamExternalProviderId !== undefined &&
      incoming.trackedTeamExternalProviderId !==
        existing.trackedTeamExternalProviderId)
  ) {
    throw new Error(
      "Match provider fixture or tracked Team binding conflicts.",
    );
  }
}
