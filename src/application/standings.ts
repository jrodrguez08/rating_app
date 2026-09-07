import type { StandingsSnapshot } from "@/domain/models";

export interface StandingsViewModel {
  competitionName: string;
  seasonName: string;
  providerSyncedAt: string;
  rows: Array<StandingsSnapshot["rows"][number] & { trackedTeam: boolean }>;
}

export function buildStandingsView(
  snapshot: StandingsSnapshot,
  trackedTeamExternalProviderId: string,
): StandingsViewModel {
  return {
    competitionName: snapshot.competitionName,
    seasonName: snapshot.seasonName,
    providerSyncedAt: snapshot.providerSyncedAt,
    rows: snapshot.rows.map((row) => ({
      ...row,
      trackedTeam: row.externalTeamId === trackedTeamExternalProviderId,
    })),
  };
}
