import { createHash } from "node:crypto";

import type { WrappedStatisticsCandidate } from "@/application/wrapped-statistics";

export const WRAPPED_SNAPSHOT_SCHEMA = 1;
export const WRAPPED_ALGORITHM = "wrapped-statistics-v1";

export class WrappedSnapshotError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "unavailable"
      | "stale_candidate"
      | "oversized_evidence"
      | "edition_conflict",
  ) {
    super(code);
  }
}

export function wrappedSnapshotHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return (
      "{" +
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => JSON.stringify(key) + ":" + canonicalJson(entry))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

export function wrappedEditionId(
  teamId: string,
  tournamentKey: string,
): string {
  return wrappedSnapshotHash([teamId, tournamentKey]);
}

export function wrappedProjection(candidate: WrappedStatisticsCandidate) {
  const {
    clubSlug,
    teamId,
    tournament,
    overview,
    coverage,
    eligibility,
    awards,
  } = candidate;
  return {
    clubSlug,
    teamId,
    tournament,
    overview,
    coverage,
    eligibility,
    awards,
  };
}

export type WrappedProjection = ReturnType<typeof wrappedProjection>;
