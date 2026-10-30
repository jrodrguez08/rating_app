import { hasAuthoritativeFinalWhistle } from "@/domain/manual-voting";
import type { Match } from "@/domain/models";
import { getVotingWindowState } from "@/domain/voting-window";

const HOUR = 60 * 60 * 1000;
const CURRENT_MATCH_GRACE_MS = 4 * HOUR;

export function selectPublicMatch(
  matches: Match[],
  now: Date,
): Match | undefined {
  const byKickoff = [...matches].sort(compareKickoff);
  return (
    byKickoff.find((match) => getVotingWindowState(match, now) === "active") ??
    byKickoff.find((match) => isCurrentPublicLiveMatch(match, now)) ??
    byKickoff.find((match) => isPublicUpcomingMatch(match, now)) ??
    [...byKickoff].reverse().find((match) => isPublicHistoricalMatch(match))
  );
}

export function isPublicUpcomingMatch(match: Match, now: Date): boolean {
  return (
    match.status === "scheduled" &&
    match.ratingState === "not_ready" &&
    kickoffTime(match) >= now.getTime() - CURRENT_MATCH_GRACE_MS
  );
}

export function isPublicHistoricalMatch(match: Match): boolean {
  return (
    match.ratingState === "rating_closed" || hasAuthoritativeFinalWhistle(match)
  );
}

function isCurrentPublicLiveMatch(match: Match, now: Date): boolean {
  const kickoff = kickoffTime(match);
  return (
    match.status === "live" &&
    (match.ratingState === "not_ready" ||
      match.ratingState === "preparing_rating") &&
    kickoff <= now.getTime() &&
    now.getTime() - kickoff <= CURRENT_MATCH_GRACE_MS
  );
}

function compareKickoff(left: Match, right: Match): number {
  return kickoffTime(left) - kickoffTime(right);
}

function kickoffTime(match: Match): number {
  return new Date(match.kickoffAt).getTime();
}
