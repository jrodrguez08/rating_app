import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { clubs } from "@/config/club";
import { coachProviderAliasId } from "@/domain/coach-identity";
import type { Coach } from "@/domain/models";
import { AdminConsoleService } from "@/lib/firebase/admin-console";
import { AdminCoachIdentityService } from "@/lib/firebase/admin-coach-identity";
import {
  CoachSearchIndexIncompleteError,
  searchIndexedCoaches,
  type CoachIndexReadObserver,
} from "@/lib/firebase/coach-search-index";
import { AdminFootballSyncStore } from "@/lib/firebase/server";
import { runCoachSearchBackfill } from "../../scripts/backfill-coach-search";

const apps: App[] = [];
const fixtureId = "shared-fixture";
const providerId = "12345";
const herediano = clubs.herediano.teamId;
const saprissa = clubs.saprissa.teamId;
const timestamp = Timestamp.fromDate(new Date("2026-10-01T00:00:00Z"));

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
});

function isolatedDatabase(label: string): Firestore {
  const app = initializeApp(
    { projectId: `demo-coach-alias-${label}-${Date.now()}` },
    `coach-alias-${label}-${Date.now()}`,
  );
  apps.push(app);
  return getFirestore(app);
}

async function seedLegacyPair(database: Firestore, canonicalFirst: boolean) {
  const canonicalId = canonicalFirst
    ? "coach-a-canonical"
    : "coach-z-canonical";
  const duplicateId = canonicalFirst
    ? "coach-z-duplicate"
    : "coach-a-duplicate";
  const aliasId = coachProviderAliasId("api-football", providerId);
  const batch = database.batch();
  for (const [id, name, teams] of [
    [canonicalId, "Jafet Manual", [saprissa]],
    [duplicateId, "Juan Proveedor", [herediano]],
    ["coach-unassociated", "Entrenador Libre", []],
  ] as const) {
    batch.set(database.doc(`coaches/${id}`), {
      displayName: name,
      identityProvenance: id === canonicalId ? "operator_verified" : "provider",
      externalProvider: "api-football",
      externalProviderId: id === "coach-unassociated" ? "99999" : providerId,
      associatedTeamIds: teams,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  for (let index = 0; index < 23; index += 1) {
    batch.set(
      database.doc(`coaches/coach-filler-${index.toString().padStart(2, "0")}`),
      {
        displayName: `Director ${index}`,
        associatedTeamIds: [herediano],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    );
  }
  batch.set(database.doc(`coachProviderAliases/${aliasId}`), {
    canonicalCoachId: canonicalId,
    externalProvider: "api-football",
    externalProviderCoachId: providerId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  batch.set(
    database.doc("matches/legacy-duplicate/coachAssignments/head-coach"),
    {
      coachId: duplicateId,
      teamId: herediano,
      matchId: "legacy-duplicate",
    },
  );
  batch.set(database.doc("matches/legacy-duplicate"), {
    id: "legacy-duplicate",
    trackedTeamId: herediano,
    ratingState: "rating_closed",
    votingOpensAt: timestamp,
    votingClosesAt: Timestamp.fromDate(new Date("2026-10-01T02:00:00Z")),
  });
  batch.set(
    database.doc("matches/legacy-verified/verifiedCoachAssignments/head-coach"),
    {
      coachId: duplicateId,
      trackedTeamId: saprissa,
      matchId: "legacy-verified",
    },
  );
  batch.set(
    database.doc("matches/legacy-canonical/coachAssignments/head-coach"),
    {
      coachId: canonicalId,
      teamId: saprissa,
      matchId: "legacy-canonical",
    },
  );
  for (const [teamId, matchId] of [
    [herediano, "match-herediano"],
    [saprissa, "match-saprissa"],
  ]) {
    batch.set(database.doc(`matches/${matchId}`), {
      id: matchId,
      trackedTeamId: teamId,
      externalProviderFixtureId: fixtureId,
      ratingState: "preparing_rating",
    });
  }
  const protectedPaths = [
    `coachProviderAliases/${aliasId}`,
    "matches/legacy-duplicate",
    "matches/legacy-duplicate/coachAssignments/head-coach",
    "matches/legacy-verified/verifiedCoachAssignments/head-coach",
    "matches/legacy-canonical/coachAssignments/head-coach",
    "matches/legacy-duplicate/verifiedLineups/current",
    "matches/legacy-duplicate/ballots/voter",
    "matches/legacy-duplicate/results/summary",
    "matches/legacy-duplicate/resultRevisions/revision",
    "adminAudit/legacy-coach",
    "matches/match-herediano",
    "matches/match-saprissa",
  ];
  for (const path of protectedPaths.slice(5, 10)) {
    batch.set(database.doc(path), { preserved: true, createdAt: timestamp });
  }
  await batch.commit();
  return { canonicalId, duplicateId, aliasId, protectedPaths };
}

async function protectedData(database: Firestore, paths: string[]) {
  return (
    await database.getAll(...paths.map((path) => database.doc(path)))
  ).map((snapshot) => snapshot.data());
}

describe("legacy Coach alias backfill", () => {
  it.each([true, false])(
    "uses the reviewed canonical Coach when canonical sorts first: %s",
    async (canonicalFirst) => {
      const database = isolatedDatabase(`ordering-${canonicalFirst}`);
      const { canonicalId, duplicateId, protectedPaths } = await seedLegacyPair(
        database,
        canonicalFirst,
      );
      const before = await protectedData(database, protectedPaths);
      const canonicalBefore = (
        await database.doc(`coaches/${canonicalId}`).get()
      ).data();
      const duplicateBefore = (
        await database.doc(`coaches/${duplicateId}`).get()
      ).data();
      const dryRun = await runCoachSearchBackfill(database, false);
      expect(dryRun).toMatchObject({
        blockingIssues: 0,
        indexStatus: "complete",
        writes: 0,
      });
      expect((await database.doc("coachSearchIndex/state").get()).exists).toBe(
        false,
      );
      expect(await protectedData(database, protectedPaths)).toEqual(before);

      await runCoachSearchBackfill(database, true);
      const canonical = (
        await database.doc(`coaches/${canonicalId}`).get()
      ).data();
      const duplicate = (
        await database.doc(`coaches/${duplicateId}`).get()
      ).data();
      expect(canonical?.displayName).toBe(canonicalBefore?.displayName);
      expect(canonical?.externalProviderId).toBe(
        canonicalBefore?.externalProviderId,
      );
      expect(canonical?.identityProvenance).toBe(
        canonicalBefore?.identityProvenance,
      );
      expect(canonical).toMatchObject({
        associatedTeamIds: [herediano, saprissa],
        searchHiddenByAlias: false,
        teamBrowseKeys: [herediano, saprissa],
      });
      expect(canonical?.teamSearchKeys).toContain(`${herediano}:jafet`);
      expect(canonical?.unassociatedSearchKeys).toEqual([]);
      expect(duplicate?.displayName).toBe(duplicateBefore?.displayName);
      expect(duplicate?.externalProviderId).toBe(
        duplicateBefore?.externalProviderId,
      );
      expect(duplicate?.associatedTeamIds).toEqual([herediano, saprissa]);
      expect(duplicate).toMatchObject({
        searchHiddenByAlias: true,
        searchPrefixes: [],
        teamBrowseKeys: [],
        teamSearchKeys: [],
        unassociatedSearchKeys: [],
      });
      expect(
        (await database.doc("coachSearchIndex/state").get()).data(),
      ).toMatchObject({
        status: "complete",
        blockingIssueCount: 0,
      });

      const reads: Parameters<CoachIndexReadObserver>[0][] = [];
      const observe: CoachIndexReadObserver = (read) => reads.push(read);
      const service = new AdminConsoleService(
        database,
        undefined,
        undefined,
        observe,
      );
      for (const [teamId, matchId] of [
        [herediano, "match-herediano"],
        [saprissa, "match-saprissa"],
      ]) {
        expect(
          (
            await service.searchCoaches(
              matchId,
              teamId,
              fixtureId,
              "team",
              "jafet",
            )
          )?.coaches.map((coach) => coach.id),
        ).toEqual([canonicalId]);
      }
      expect(
        await service.searchCoaches(
          "match-saprissa",
          herediano,
          fixtureId,
          "team",
          "",
        ),
      ).toBeNull();
      expect(
        await service.searchCoaches(
          "match-herediano",
          herediano,
          "wrong",
          "team",
          "",
        ),
      ).toBeNull();
      expect(
        (await searchIndexedCoaches(database, herediano, "team", "juan"))
          .coaches,
      ).toEqual([]);
      expect(
        (
          await searchIndexedCoaches(
            database,
            herediano,
            "unassociated",
            "jafet",
          )
        ).coaches,
      ).toEqual([]);
      expect(
        (
          await searchIndexedCoaches(
            database,
            herediano,
            "unassociated",
            "libre",
          )
        ).coaches.map((coach) => coach.id),
      ).toEqual(["coach-unassociated"]);
      expect(
        (
          await new AdminCoachIdentityService(database).search(
            herediano,
            "jafet",
          )
        ).coaches.map((coach) => coach.id),
      ).toEqual([canonicalId]);
      expect(reads.every((read) => read.documents <= 21)).toBe(true);

      let cursor: string | undefined;
      const ids: string[] = [];
      do {
        const page = await searchIndexedCoaches(
          database,
          herediano,
          "team",
          "",
          cursor,
        );
        ids.push(...page.coaches.map((coach) => coach.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids).toContain(canonicalId);
      expect(ids).not.toContain(duplicateId);
      expect(ids.filter((id) => id === canonicalId)).toHaveLength(1);
      expect(new Set(ids).size).toBe(ids.length);
      const observedDuplicate: Coach = {
        id: duplicateId,
        displayName: "Juan Proveedor",
        identityProvenance: "provider",
        externalProvider: "api-football",
        externalProviderId: providerId,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-02T00:00:00.000Z",
      };
      await new AdminFootballSyncStore(database).upsertCoaches([
        observedDuplicate,
      ]);
      expect(
        (await database.doc(`coaches/${duplicateId}`).get()).data(),
      ).toMatchObject({
        searchHiddenByAlias: true,
        teamBrowseKeys: [],
        teamSearchKeys: [],
        unassociatedSearchKeys: [],
      });
      expect(
        (await searchIndexedCoaches(database, herediano, "team", "juan"))
          .coaches,
      ).toEqual([]);
      expect(
        (await runCoachSearchBackfill(database, false)).changedCoaches,
      ).toBe(0);
      expect(
        (await runCoachSearchBackfill(database, true)).changedCoaches,
      ).toBe(0);
      expect(await protectedData(database, protectedPaths)).toEqual(before);
    },
  );

  it("preserves a valid self-target alias without hiding its Coach", async () => {
    const database = isolatedDatabase("self");
    const id = "coach-self";
    const batch = database.batch();
    batch.set(database.doc(`coaches/${id}`), {
      displayName: "Director Solo",
      externalProvider: "api-football",
      externalProviderId: providerId,
      associatedTeamIds: [herediano],
    });
    batch.set(
      database.doc(
        `coachProviderAliases/${coachProviderAliasId("api-football", providerId)}`,
      ),
      {
        canonicalCoachId: id,
        externalProvider: "api-football",
        externalProviderCoachId: providerId,
      },
    );
    await batch.commit();
    expect((await runCoachSearchBackfill(database, true)).indexStatus).toBe(
      "complete",
    );
    expect(
      (
        await searchIndexedCoaches(database, herediano, "team", "solo")
      ).coaches.map((coach) => coach.id),
    ).toEqual([id]);
    await database.doc("coachSearchIndex/state").update({ schemaVersion: 1 });
    await expect(
      searchIndexedCoaches(database, herediano, "team", "solo"),
    ).rejects.toBeInstanceOf(CoachSearchIndexIncompleteError);
  });

  it.each(["missing-target", "wrong-binding", "conflicting-canonical"])(
    "blocks incomplete alias evidence: %s",
    async (caseName) => {
      const database = isolatedDatabase(caseName);
      const aliasId = coachProviderAliasId("api-football", providerId);
      const batch = database.batch();
      batch.set(database.doc("coaches/coach-provider"), {
        displayName: "Proveedor",
        externalProvider: "api-football",
        externalProviderId: providerId,
      });
      if (caseName !== "missing-target") {
        batch.set(database.doc("coaches/coach-canonical"), {
          displayName: "Canónico",
          ...(caseName === "conflicting-canonical"
            ? {
                externalProvider: "api-football",
                externalProviderId: "different",
              }
            : {}),
        });
      }
      batch.set(database.doc(`coachProviderAliases/${aliasId}`), {
        canonicalCoachId: "coach-canonical",
        externalProvider: "api-football",
        externalProviderCoachId:
          caseName === "wrong-binding" ? "wrong" : providerId,
      });
      await batch.commit();
      expect(
        (await runCoachSearchBackfill(database, false)).blockingIssues,
      ).toBeGreaterThan(0);
      expect((await runCoachSearchBackfill(database, true)).indexStatus).toBe(
        "incomplete",
      );
      await expect(
        searchIndexedCoaches(database, herediano, "team", ""),
      ).rejects.toBeInstanceOf(CoachSearchIndexIncompleteError);
    },
  );

  it("keeps the marker incomplete when a Coach update batch fails", async () => {
    const database = isolatedDatabase("failed-batch");
    await database.doc("coaches/coach-one").set({ displayName: "Director" });
    const batchFactory = database.batch.bind(database);
    const batchSpy = vi.spyOn(database, "batch").mockImplementationOnce(() => {
      const batch = batchFactory();
      vi.spyOn(batch, "commit").mockRejectedValueOnce(
        new Error("batch failed"),
      );
      return batch;
    });
    await expect(runCoachSearchBackfill(database, true)).rejects.toThrow(
      "batch failed",
    );
    batchSpy.mockRestore();
    expect(
      (await database.doc("coachSearchIndex/state").get()).data()?.status,
    ).toBe("incomplete");
    await expect(
      searchIndexedCoaches(database, herediano, "team", ""),
    ).rejects.toBeInstanceOf(CoachSearchIndexIncompleteError);
    expect((await runCoachSearchBackfill(database, true)).indexStatus).toBe(
      "complete",
    );
  });
});
