import { describe, expect, it } from "vitest";

import type { StandingsSnapshot } from "@/domain/models";
import type {
  ProviderStandingsRow,
  StandingsDataProvider,
  StandingsSyncStore,
  StandingsSyncTarget,
} from "@/domain/ports";

import { syncStandings } from "./sync-standings";

const NOW = new Date("2026-09-07T09:00:00.000Z");
const target: StandingsSyncTarget = {
  trackedTeamId: "team-1",
  competitionId: "competition-1",
  competitionName: "Primera División",
  seasonId: "season-1",
  seasonName: "2026",
  externalProvider: "api-football",
  externalProviderCompetitionId: "162",
  externalProviderSeason: 2026,
};
const rows: ProviderStandingsRow[] = [
  {
    rank: 1,
    externalTeamId: "815",
    teamName: "CS Herediano",
    played: 4,
    won: 3,
    drawn: 1,
    lost: 0,
    goalsFor: 8,
    goalsAgainst: 3,
    goalDifference: 5,
    points: 10,
  },
];

class MemoryStore implements StandingsSyncStore {
  target: StandingsSyncTarget | null = target;
  snapshot: StandingsSnapshot | null = null;
  replacements = 0;

  async getStandingsTarget() {
    return this.target;
  }
  async getStandingsSnapshot() {
    return this.snapshot;
  }
  async replaceStandingsSnapshot(snapshot: StandingsSnapshot) {
    this.replacements += 1;
    this.snapshot = snapshot;
  }
}

class Provider implements StandingsDataProvider {
  readonly name = "api-football";
  requestCount = 0;

  constructor(
    private readonly values: ProviderStandingsRow[] = rows,
    private readonly failure?: Error,
  ) {}

  async getStandings() {
    this.requestCount += 1;
    if (this.failure) throw this.failure;
    return this.values;
  }
}

describe("standings synchronization", () => {
  it("atomically replaces a snapshot after one successful provider request", async () => {
    const store = new MemoryStore();
    const provider = new Provider();
    const logs: string[] = [];

    const result = await syncStandings(
      "team-1",
      provider,
      store,
      NOW,
      (message) => logs.push(message),
    );

    expect(result).toMatchObject({
      action: "snapshot_replaced",
      competitionId: "competition-1",
      rows: 1,
      providerRequests: 1,
    });
    expect(store.replacements).toBe(1);
    expect(store.snapshot).toMatchObject({
      id: "team-1",
      externalProviderCompetitionId: "162",
      externalProviderSeason: 2026,
      rows,
      providerSyncedAt: NOW.toISOString(),
    });
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"event":"standings.sync_started"'),
        expect.stringContaining('"event":"standings.snapshot_replaced"'),
        expect.stringContaining(
          '"event":"standings.sync_outcome","action":"snapshot_replaced"',
        ),
      ]),
    );
  });

  it.each([
    ["empty response", new Provider([]), "empty-provider-response"],
    [
      "malformed response",
      new Provider(rows, providerError()),
      "malformed-response",
    ],
    [
      "request failure",
      new Provider(rows, new Error("network details")),
      "standings-sync-failed",
    ],
  ])(
    "preserves the latest valid snapshot after %s",
    async (_label, provider, reason) => {
      const store = new MemoryStore();
      store.snapshot = snapshot();

      const result = await syncStandings("team-1", provider, store, NOW);

      expect(result).toMatchObject({
        action: "snapshot_preserved",
        rows: 1,
        reason,
      });
      expect(store.snapshot).toEqual(snapshot());
      expect(store.replacements).toBe(0);
      expect(provider.requestCount).toBe(1);
    },
  );

  it("leaves a safe empty read state when the first provider request fails", async () => {
    const store = new MemoryStore();
    const result = await syncStandings(
      "team-1",
      new Provider(rows, new Error("offline")),
      store,
      NOW,
    );

    expect(result).toMatchObject({
      action: "snapshot_preserved",
      rows: 0,
      previousSnapshotExisted: false,
    });
    expect(store.snapshot).toBeNull();
  });

  it("does not call the provider without a persisted current league season", async () => {
    const store = new MemoryStore();
    store.target = null;
    const provider = new Provider();

    const result = await syncStandings("team-1", provider, store, NOW);

    expect(result.reason).toBe("current-league-season-unavailable");
    expect(provider.requestCount).toBe(0);
    expect(store.replacements).toBe(0);
  });

  it("does not let a failing logger change synchronization", async () => {
    const store = new MemoryStore();
    const provider = new Provider();

    await expect(
      syncStandings("team-1", provider, store, NOW, () => {
        throw new Error("logging unavailable");
      }),
    ).resolves.toMatchObject({ action: "snapshot_replaced" });
    expect(provider.requestCount).toBe(1);
  });
});

function snapshot(): StandingsSnapshot {
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
    rows,
    providerSyncedAt: "2026-09-06T09:00:00.000Z",
    createdAt: "2026-09-06T09:00:00.000Z",
    updatedAt: "2026-09-06T09:00:00.000Z",
  };
}

function providerError() {
  return Object.assign(new Error("malformed private detail"), {
    code: "malformed-response",
  });
}
