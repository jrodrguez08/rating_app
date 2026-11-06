import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, expect, it } from "vitest";

import { parseWrappedLedger } from "@/application/wrapped-ledger";
import { AdminResultService } from "@/lib/firebase/server";

import { previewWrappedCoverage } from "../../scripts/lib/wrapped-preview";
import {
  asOf,
  competition,
  ledgerInput,
  season,
  wrappedFixture,
  wrappedMatch,
  wrappedSummary,
  wrappedTeam,
} from "../wrapped-fixtures";
import { measureReads } from "./read-counts";

const app = initializeApp(
  { projectId: "demo-wrapped-preview" },
  "wrapped-preview",
);
const database = getFirestore(app);

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Firestore emulator required.");
  const batch = database.batch();
  batch.set(database.doc("competitions/" + competition.id), competition);
  batch.set(database.doc("seasons/" + season.id), season);
  for (const slug of ["herediano", "saprissa"] as const) {
    const team = wrappedTeam(slug);
    batch.set(database.doc("teams/" + team.id), team);
  }
  batch.set(database.doc("matches/unrelated"), { unrelated: true });
  await batch.commit();
});

afterAll(() => deleteApp(app));

it("reads every ledger batch and keeps shared fixtures and current summaries Team-scoped", async () => {
  const home = Array.from({ length: 52 }, (_, index) =>
    wrappedMatch("herediano", String(index + 1)),
  );
  const away = wrappedMatch("saprissa", "52");
  const missing = wrappedMatch("herediano", "missing");
  const reopened = wrappedMatch("herediano", "reopen", {
    ratingState: "rating_ready",
    votingReopenCount: 1,
  });
  const foreign = wrappedMatch("herediano", "foreign", {
    trackedTeamId: away.trackedTeamId,
  });
  const batch = database.batch();
  for (const match of [...home, away, reopened, foreign]) {
    batch.set(database.doc("matches/" + match.id), {
      ...match,
      kickoffAt: Timestamp.fromDate(new Date(match.kickoffAt)),
    });
    const summary = wrappedSummary(match, match === away ? 2 : 1);
    batch.set(database.doc("matches/" + match.id + "/results/summary"), {
      ...summary,
      generatedAt: Timestamp.fromDate(new Date(summary.generatedAt)),
    });
  }
  await batch.commit();

  const homeLedger = parseWrappedLedger(
    ledgerInput(
      "herediano",
      [...home, missing, reopened, foreign].map(wrappedFixture).reverse(),
    ),
  );
  const awayLedger = parseWrappedLedger(
    ledgerInput("saprissa", [wrappedFixture(away)]),
  );
  const homeKey = homeLedger.tournaments[0].key;
  const read = await measureReads(() =>
    previewWrappedCoverage(database, homeLedger, homeKey, asOf),
  );
  expect(read.value.counts).toMatchObject({
    expectedFixtures: 55,
    rated: 52,
    totalValidBallots: 52,
  });
  expect(read.value.fixtureBlockers).toEqual(
    expect.arrayContaining([
      { matchId: missing.id, code: "missing_match" },
      { matchId: reopened.id, code: "reopened" },
      { matchId: foreign.id, code: "invalid_match" },
    ]),
  );
  expect(read.value.coverageComplete).toBe(false);
  expect(read.documents).toBe(3 + 55 + 52);
  expect(read.queries).toBe(0);
  expect(read.batchSizes).toEqual([3, 50, 5, 50, 2]);
  expect(read.paths).not.toContain("matches/unrelated");
  expect(read.paths).not.toContain("matches/" + away.id);
  expect(read.paths).not.toContain(
    "matches/" + reopened.id + "/results/summary",
  );
  expect(read.paths).not.toContain(
    "matches/" + foreign.id + "/results/summary",
  );
  expect(read.paths.every((path) => !path.includes("/ballots/"))).toBe(true);
  const other = await measureReads(() =>
    previewWrappedCoverage(database, awayLedger, homeKey, asOf),
  );
  expect(other.value).toMatchObject({
    coverageComplete: true,
    counts: { rated: 1, totalValidBallots: 2 },
  });
  expect(other.documents).toBe(5);
  expect(other.queries).toBe(0);
  const shared = await new AdminResultService(database).getPageState(
    away.id,
    away.trackedTeamId,
    asOf,
  );
  expect(shared).toMatchObject({ state: "ready", result: { ballotCount: 2 } });
  expect(
    await new AdminResultService(database).getPageState(
      away.id,
      home[0].trackedTeamId,
      asOf,
    ),
  ).toEqual({ state: "unavailable" });
});

it("stops before fixture reads when persisted competition/season binding disagrees", async () => {
  const fixture = wrappedFixture(wrappedMatch("saprissa", "53"));
  const ledger = parseWrappedLedger(
    ledgerInput("saprissa", [fixture], { providerSeason: 2024 }),
  );
  const read = await measureReads(() =>
    previewWrappedCoverage(database, ledger, ledger.tournaments[0].key, asOf),
  );
  expect(read.value).toMatchObject({
    coverageComplete: false,
    blockers: ["scope_unverified"],
    fixtures: [
      {
        matchPresence: "unchecked",
        observation: { status: "scope_unverified" },
      },
    ],
  });
  expect(read.documents).toBe(3);
  expect(read.queries).toBe(0);
});

it("runs the actual CLI for a zero-vote final and refuses production targets", async () => {
  const match = wrappedMatch("saprissa", "cli-zero");
  const batch = database.batch();
  batch.set(database.doc("matches/" + match.id), match);
  batch.set(
    database.doc("matches/" + match.id + "/results/summary"),
    wrappedSummary(match, 0),
  );
  await batch.commit();
  const dir = await mkdtemp(join(tmpdir(), "wrapped-preview-"));
  try {
    const input = join(dir, "ledger.json");
    await writeFile(
      input,
      JSON.stringify(ledgerInput("saprissa", [wrappedFixture(match)])),
      "utf8",
    );
    const run = (project: string) =>
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/preview-wrapped.ts",
          "--input",
          input,
          "--tournament",
          "wrapped-league:2025:clausura",
          "--project-id",
          project,
          "--as-of",
          asOf.toISOString(),
        ],
        { env: { ...process.env, GCLOUD_PROJECT: "demo-wrapped-preview" } },
      );
    const { stdout } = await run("demo-wrapped-preview");
    expect(JSON.parse(stdout)).toMatchObject({
      clubSlug: "saprissa",
      coverageComplete: true,
      counts: {
        zeroVotes: 1,
        totalValidBallots: 0,
        ratedFixtureCoveragePercent: 0,
        ratedCompletedFixturePercent: 0,
      },
    });
    await expect(run("rating-app-prod-8b7df")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("explicit loopback Firestore emulator"),
    });
    await database.doc("matches/" + match.id + "/results/summary").delete();
    await expect(run("demo-wrapped-preview")).rejects.toMatchObject({
      code: 2,
      stdout: expect.stringContaining("summary_missing"),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
