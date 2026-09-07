import type { StandingsSnapshot } from "@/domain/models";
import type { StandingsDataProvider, StandingsSyncStore } from "@/domain/ports";
import {
  emitOperationalLog,
  type OperationalLogger,
} from "@/lib/operational-log";

export interface StandingsSyncResult {
  action: "snapshot_replaced" | "snapshot_preserved";
  trackedTeamId: string;
  competitionId?: string;
  rows: number;
  previousSnapshotExisted: boolean;
  providerRequests: number;
  reason?: string;
}

export async function syncStandings(
  trackedTeamId: string,
  provider: StandingsDataProvider,
  store: StandingsSyncStore,
  now = new Date(),
  log: OperationalLogger = () => undefined,
): Promise<StandingsSyncResult> {
  const previous = await store.getStandingsSnapshot(trackedTeamId);
  const target = await store.getStandingsTarget(trackedTeamId);
  if (target === null) {
    return preserved(
      trackedTeamId,
      provider,
      previous,
      "current-league-season-unavailable",
      log,
    );
  }
  emitOperationalLog(log, "standings.sync_started", {
    trackedTeamId,
    competitionId: target.competitionId,
    externalProviderCompetitionId: target.externalProviderCompetitionId,
    externalProviderSeason: target.externalProviderSeason,
    previousSnapshotExisted: previous !== null,
    phase: "provider_request",
  });
  if (target.externalProvider !== provider.name) {
    return preserved(
      trackedTeamId,
      provider,
      previous,
      "provider-mismatch",
      log,
      target.competitionId,
    );
  }
  try {
    const rows = await provider.getStandings(
      target.externalProviderCompetitionId,
      target.externalProviderSeason,
    );
    if (rows.length === 0) {
      return preserved(
        trackedTeamId,
        provider,
        previous,
        "empty-provider-response",
        log,
        target.competitionId,
      );
    }
    const timestamp = now.toISOString();
    const snapshot: StandingsSnapshot = {
      id: trackedTeamId,
      trackedTeamId,
      competitionId: target.competitionId,
      competitionName: target.competitionName,
      seasonId: target.seasonId,
      seasonName: target.seasonName,
      externalProvider: provider.name,
      externalProviderCompetitionId: target.externalProviderCompetitionId,
      externalProviderSeason: target.externalProviderSeason,
      rows,
      providerSyncedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await store.replaceStandingsSnapshot(snapshot);
    emitOperationalLog(log, "standings.snapshot_replaced", {
      trackedTeamId,
      competitionId: target.competitionId,
      rowsValidated: rows.length,
      previousSnapshotExisted: previous !== null,
      providerRequests: provider.requestCount,
    });
    const result: StandingsSyncResult = {
      action: "snapshot_replaced",
      trackedTeamId,
      competitionId: target.competitionId,
      rows: rows.length,
      previousSnapshotExisted: previous !== null,
      providerRequests: provider.requestCount,
    };
    logOutcome(result, log);
    return result;
  } catch (error) {
    return preserved(
      trackedTeamId,
      provider,
      previous,
      operationalErrorReason(error),
      log,
      target.competitionId,
    );
  }
}

function preserved(
  trackedTeamId: string,
  provider: StandingsDataProvider,
  previous: StandingsSnapshot | null,
  reason: string,
  log: OperationalLogger,
  competitionId?: string,
): StandingsSyncResult {
  emitOperationalLog(log, "standings.snapshot_preserved", {
    trackedTeamId,
    competitionId: competitionId ?? "unavailable",
    previousSnapshotExisted: previous !== null,
    rowsPreserved: previous?.rows.length ?? 0,
    providerRequests: provider.requestCount,
    reason,
  });
  const result: StandingsSyncResult = {
    action: "snapshot_preserved",
    trackedTeamId,
    ...(competitionId === undefined ? {} : { competitionId }),
    rows: previous?.rows.length ?? 0,
    previousSnapshotExisted: previous !== null,
    providerRequests: provider.requestCount,
    reason,
  };
  logOutcome(result, log);
  return result;
}

function logOutcome(result: StandingsSyncResult, log: OperationalLogger): void {
  emitOperationalLog(log, "standings.sync_outcome", {
    action: result.action,
    trackedTeamId: result.trackedTeamId,
    competitionId: result.competitionId ?? "unavailable",
    rows: result.rows,
    providerRequests: result.providerRequests,
    reason: result.reason ?? "success",
  });
}

function operationalErrorReason(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "standings-sync-failed";
}
