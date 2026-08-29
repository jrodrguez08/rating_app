import { readFileSync } from "node:fs";

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { syncFootballData } from "@/application/sync-football";
import type {
  FootballDataProvider,
  ProviderCompetitionSeason,
  ProviderFixture,
  ProviderTeamIdentity,
} from "@/domain/ports";

import { ensureDevelopmentTeam } from "../../scripts/seed-development.mjs";
import { EmulatorFootballSyncStore } from "../../scripts/lib/emulator-firestore";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
let environment: RulesTestEnvironment;
let emulatorHost: string;

const seasons: ProviderCompetitionSeason[] = [
  {
    externalCompetitionId: "71",
    competitionName: "Primera Division",
    countryName: "Costa Rica",
    countryCode: "CR",
    type: "league",
    providerSeason: 2026,
    startsAt: "2026-07-20T00:00:00.000Z",
    endsAt: "2027-05-30T00:00:00.000Z",
    isCurrent: true,
  },
  {
    externalCompetitionId: "999",
    competitionName: "Regional Cup",
    countryName: "Costa Rica",
    type: "cup",
    providerSeason: 2026,
    isCurrent: true,
  },
];

const fixtures: ProviderFixture[] = [
  {
    externalFixtureId: "5001",
    externalCompetitionId: "71",
    providerSeason: 2026,
    kickoffAt: "2026-08-20T08:00:00.000Z",
    status: "finished",
    homeTeam: { externalProviderId: "1234", name: "Herediano" },
    awayTeam: { externalProviderId: "2000", name: "Alajuelense" },
    score: { home: 2, away: 1 },
  },
  {
    externalFixtureId: "5002",
    externalCompetitionId: "999",
    providerSeason: 2026,
    kickoffAt: "2026-09-02T20:00:00.000Z",
    status: "scheduled",
    homeTeam: { externalProviderId: "3000", name: "Saprissa" },
    awayTeam: { externalProviderId: "1234", name: "Herediano" },
    score: { home: null, away: null },
  },
];

class FixtureProvider implements FootballDataProvider {
  readonly name = "api-football";
  requestCount = 0;

  constructor(
    private readonly fixtureValues = fixtures,
    private readonly seasonValues = seasons,
  ) {}

  async resolveTeam(): Promise<ProviderTeamIdentity> {
    this.requestCount += 1;
    return {
      externalProviderId: "1234",
      name: "Herediano",
      countryName: "Costa Rica",
    };
  }

  async getCompetitionSeasons(): Promise<ProviderCompetitionSeason[]> {
    this.requestCount += 1;
    return this.seasonValues;
  }

  async getFixtures(): Promise<ProviderFixture[]> {
    this.requestCount += 1;
    return this.fixtureValues;
  }
}

beforeAll(async () => {
  emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const [host, port] = emulatorHost.split(":");
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await ensureDevelopmentTeam({ emulatorHost, projectId });
});
afterAll(async () => environment.cleanup());

async function collectionData(collection: string) {
  let values: Array<Record<string, unknown>> = [];
  await environment.withSecurityRulesDisabled(async (context) => {
    const snapshot = await context.firestore().collection(collection).get();
    values = snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));
  });
  return values;
}

describe("football synchronization persistence", () => {
  it("creates distinct competitions, seasons, and home/away matches idempotently", async () => {
    const store = new EmulatorFootballSyncStore(emulatorHost, projectId);
    const team = await store.getTeam("club-sport-herediano");
    const first = await syncFootballData(team, new FixtureProvider(), store, {
      now: new Date("2026-08-29T12:00:00.000Z"),
    });
    const persistedTeam = await store.getTeam(team.id);
    const second = await syncFootballData(
      persistedTeam,
      new FixtureProvider(),
      store,
      { now: new Date("2026-08-29T12:00:00.000Z") },
    );

    expect(first.competitions.created).toBe(2);
    expect(first.seasons.created).toBe(2);
    expect(first.matches.created).toBe(2);
    expect(second.competitions.unchanged).toBe(2);
    expect(second.seasons.unchanged).toBe(2);
    expect(second.matches.unchanged).toBe(2);
    expect(await collectionData("competitions")).toHaveLength(2);
    expect(await collectionData("seasons")).toHaveLength(2);
    const matches = await collectionData("matches");
    expect(matches).toHaveLength(2);
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalProviderFixtureId: "5001",
          homeTeam: expect.objectContaining({ externalProviderId: "1234" }),
          awayTeam: expect.objectContaining({ externalProviderId: "2000" }),
        }),
        expect.objectContaining({
          externalProviderFixtureId: "5002",
          homeTeam: expect.objectContaining({ externalProviderId: "3000" }),
          awayTeam: expect.objectContaining({ externalProviderId: "1234" }),
        }),
      ]),
    );
  });

  it("updates mutable fixture facts without creating a duplicate", async () => {
    const store = new EmulatorFootballSyncStore(emulatorHost, projectId);
    const team = await store.getTeam("club-sport-herediano");
    await syncFootballData(team, new FixtureProvider(), store, {
      now: new Date("2026-08-29T12:00:00.000Z"),
    });
    const updatedFixtures = structuredClone(fixtures);
    updatedFixtures[1].status = "finished";
    updatedFixtures[1].score = { home: 0, away: 1 };
    const summary = await syncFootballData(
      await store.getTeam(team.id),
      new FixtureProvider(updatedFixtures),
      store,
      { now: new Date("2026-08-30T12:00:00.000Z") },
    );

    expect(summary.matches.updated).toBe(1);
    expect(summary.matches.unchanged).toBe(1);
    const matches = await collectionData("matches");
    expect(matches).toHaveLength(2);
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalProviderFixtureId: "5002",
          status: "finished",
          score: { home: 0, away: 1 },
        }),
      ]),
    );
  });

  it("does not write partial sync data when fixture season metadata is malformed", async () => {
    const store = new EmulatorFootballSyncStore(emulatorHost, projectId);
    const team = await store.getTeam("club-sport-herediano");
    const invalidFixtures = [
      { ...fixtures[0], externalCompetitionId: "missing" },
    ];

    await expect(
      syncFootballData(team, new FixtureProvider(invalidFixtures), store),
    ).rejects.toThrow("metadata is missing");
    expect(await collectionData("competitions")).toHaveLength(0);
    expect(await collectionData("seasons")).toHaveLength(0);
    expect(await collectionData("matches")).toHaveLength(0);
    expect((await store.getTeam(team.id)).externalProviderId).toBeUndefined();
  });
});
