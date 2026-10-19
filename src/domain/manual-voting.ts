import type { Match, MatchStatus } from "./models";

export const DEFAULT_VOTING_WINDOW_MS = 2 * 60 * 60 * 1000;

export type ManualVotingStatusBlockReason =
  "postponed" | "suspended" | "cancelled" | "abandoned";

export type ManualVotingStatusEligibility =
  { allowed: true } | { allowed: false; reason: ManualVotingStatusBlockReason };

export function manualVotingStatusEligibility(
  status: MatchStatus,
): ManualVotingStatusEligibility {
  switch (status) {
    case "scheduled":
    case "live":
    case "finished":
      return { allowed: true };
    case "postponed":
    case "suspended":
    case "cancelled":
    case "abandoned":
      return { allowed: false, reason: status };
  }
}

export function parseCostaRicaDateTime(value: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) return null;
  const instant = new Date(`${value}:00-06:00`);
  if (Number.isNaN(instant.getTime())) return null;
  const costaRica = new Date(instant.getTime() - 6 * 60 * 60 * 1000);
  return costaRica.getUTCFullYear() === Number(parts[1]) &&
    costaRica.getUTCMonth() + 1 === Number(parts[2]) &&
    costaRica.getUTCDate() === Number(parts[3]) &&
    costaRica.getUTCHours() === Number(parts[4]) &&
    costaRica.getUTCMinutes() === Number(parts[5])
    ? instant
    : null;
}

export function manualVotingClosesAt(
  opensAt: Date,
  closeMode: "default" | "custom",
  customClosesAtLocal?: string,
): Date {
  const closesAt =
    closeMode === "default"
      ? new Date(opensAt.getTime() + DEFAULT_VOTING_WINDOW_MS)
      : parseCostaRicaDateTime(customClosesAtLocal ?? "");
  if (closesAt === null || closesAt.getTime() <= opensAt.getTime()) {
    throw new Error("The requested voting close time is invalid or expired.");
  }
  return closesAt;
}

export function hasAuthoritativeFinalWhistle(match: Match): boolean {
  return match.status === "finished" || match.votingOpeningMode === "manual";
}
