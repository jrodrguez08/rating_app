import { describe, expect, it } from "vitest";

import type { StandingsSnapshot } from "@/domain/models";

import { buildStandingsView } from "./standings";

describe("standings public read model", () => {
  it("preserves provider rank order and highlights by stable Team identity", () => {
    const view = buildStandingsView(snapshot(), "815");

    expect(view.rows.map(({ rank }) => rank)).toEqual([1, 2]);
    expect(view.rows.find(({ trackedTeam }) => trackedTeam)).toMatchObject({
      externalTeamId: "815",
      teamName: "Renamed tracked Team",
    });
  });

  it("keeps a stale but valid snapshot renderable", () => {
    const view = buildStandingsView(snapshot(), "815");

    expect(view.providerSyncedAt).toBe("2026-09-01T09:04:00.000Z");
    expect(view.rows).toHaveLength(2);
  });
});

function snapshot(): StandingsSnapshot {
  const row = {
    played: 4,
    won: 3,
    drawn: 1,
    lost: 0,
    goalsFor: 8,
    goalsAgainst: 3,
    goalDifference: 5,
    points: 10,
  };
  return {
    id: "team-1",
    trackedTeamId: "team-1",
    competitionId: "competition-1",
    competitionName: "Primera División",
    seasonId: "season-1",
    seasonName: "2026",
    externalProvider: "api-football",
    externalProviderCompetitionId: "162",
    externalProviderSeason: 2026,
    rows: [
      {
        ...row,
        rank: 1,
        externalTeamId: "815",
        teamName: "Renamed tracked Team",
      },
      {
        ...row,
        rank: 2,
        externalTeamId: "820",
        teamName: "Opponent",
        points: 7,
      },
    ],
    providerSyncedAt: "2026-09-01T09:04:00.000Z",
    createdAt: "2026-09-01T09:04:00.000Z",
    updatedAt: "2026-09-01T09:04:00.000Z",
  };
}
