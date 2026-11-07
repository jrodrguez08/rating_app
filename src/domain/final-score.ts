import type { Match } from "@/domain/models";
import type { ProviderFixture } from "@/domain/ports";

export const FINAL_SCORE_RETRY_MS = 60 * 60 * 1000;
export const FINAL_SCORE_MAX_ATTEMPTS = 12;

export function hasCompleteScore(
  score: Partial<Match["score"]> | undefined,
): boolean {
  return [score?.home, score?.away].every(
    (goal) =>
      typeof goal === "number" && Number.isSafeInteger(goal) && goal >= 0,
  );
}

export function needsManualFinalScore(match: Match): boolean {
  return (
    match.status === "scheduled" ||
    match.status === "live" ||
    (match.status === "finished" && !hasCompleteScore(match.score))
  );
}

export function confirmedManualScore(
  match: Match,
  providerName: string,
  fixture: ProviderFixture,
): Match["score"] | null {
  return providerName === match.externalProvider &&
    fixture.externalFixtureId === match.externalProviderFixtureId &&
    fixture.homeTeam.externalProviderId === match.homeTeam.externalProviderId &&
    fixture.awayTeam.externalProviderId === match.awayTeam.externalProviderId &&
    fixture.status === "finished" &&
    hasCompleteScore(fixture.score)
    ? fixture.score
    : null;
}
