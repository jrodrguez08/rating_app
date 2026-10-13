import type { Match } from "./models";

export interface EffectiveVotingWindow {
  opensAt: string;
  closesAt: string;
  reopened: boolean;
}

export function getEffectiveVotingClosesAt(match: Match): string | undefined {
  return (match.votingReopenCount ?? 0) > 0
    ? match.effectiveVotingClosesAt
    : match.votingClosesAt;
}

export function getEffectiveVotingWindow(
  match: Match,
): EffectiveVotingWindow | null {
  const reopened = (match.votingReopenCount ?? 0) > 0;
  const opensAt = reopened ? match.effectiveVotingOpensAt : match.votingOpensAt;
  const closesAt = reopened
    ? match.effectiveVotingClosesAt
    : match.votingClosesAt;
  if (opensAt === undefined || closesAt === undefined) return null;
  const opensAtMs = new Date(opensAt).getTime();
  const closesAtMs = new Date(closesAt).getTime();
  if (
    !Number.isFinite(opensAtMs) ||
    !Number.isFinite(closesAtMs) ||
    opensAtMs >= closesAtMs
  ) {
    return null;
  }
  return { opensAt, closesAt, reopened };
}

export function getVotingWindowState(
  match: Match,
  now: Date,
): "active" | "not_open" | "closed" {
  if (match.ratingState !== "rating_ready") return "not_open";
  const window = getEffectiveVotingWindow(match);
  if (window === null) return "not_open";
  if (now < new Date(window.opensAt)) return "not_open";
  if (now >= new Date(window.closesAt)) return "closed";
  return "active";
}
