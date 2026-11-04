import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clubs } from "@/config/club";
import { coachProviderAliasId } from "@/domain/coach-identity";
import { AdminConsoleService } from "@/lib/firebase/admin-console";
import { AdminCoachIdentityService } from "@/lib/firebase/admin-coach-identity";
import {
  CoachSearchIndexIncompleteError,
  CoachSearchInvalidInputError,
  searchIndexedCoaches,
  type CoachIndexReadObserver,
} from "@/lib/firebase/coach-search-index";
import { runCoachSearchBackfill } from "../../scripts/backfill-coach-search";

const projectId = `demo-coach-search-${Date.now()}`;
const app = initializeApp({ projectId }, `coach-search-${Date.now()}`);
const database = getFirestore(app);
const fixtureId = "1551706";
const heredianoMatchId = "coach-search-herediano";
const saprissaMatchId = "coach-search-saprissa";
const targetId = "coach-z-older-valid";
const aliasSourceId = "coach-provider-alias-source";
const aliasSurvivorId = "coach-manual-survivor";
const bothId = "coach-both-clubs";
const unassociatedId = "coach-unassociated";
const reads: Parameters<CoachIndexReadObserver>[0][] = [];
const observe: CoachIndexReadObserver = (read) => reads.push(read);

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
  const batch = database.batch();
  for (const [teamId, matchId] of [
    [clubs.herediano.teamId, heredianoMatchId],
    [clubs.saprissa.teamId, saprissaMatchId],
  ]) {
    batch.set(database.doc(`matches/${matchId}`), {
      trackedTeamId: teamId,
      externalProviderFixtureId: fixtureId,
    });
  }
  for (let index = 0; index < 125; index += 1) {
    const id = `coach-foreign-${String(index).padStart(3, "0")}`;
    batch.set(database.doc(`coaches/${id}`), {
      displayName: `Director rival ${index}`,
      identityProvenance: "provider",
      createdAt: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
      updatedAt: Timestamp.fromDate(new Date("2040-01-01T00:00:00Z")),
    });
    batch.set(
      database.doc(`matches/foreign-${index}/coachAssignments/head-coach`),
      {
        coachId: id,
        teamId: clubs.saprissa.teamId,
        matchId: `foreign-${index}`,
      },
    );
  }
  for (let index = 0; index < 42; index += 1) {
    const id = `coach-team-${String(index).padStart(3, "0")}`;
    batch.set(database.doc(`coaches/${id}`), {
      displayName: `Director Herediano ${index}`,
      identityProvenance: "provider",
      createdAt: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
      updatedAt: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
    });
    batch.set(
      database.doc(`matches/team-${index}/coachAssignments/head-coach`),
      { coachId: id, teamId: clubs.herediano.teamId, matchId: `team-${index}` },
    );
  }
  for (const [id, name] of [
    [targetId, "Álvaro Entrenador"],
    [aliasSourceId, "José Alias"],
    [aliasSurvivorId, "José Canónico"],
    [bothId, "Director Compartido"],
    [unassociatedId, "Director Sin Club"],
  ]) {
    batch.set(database.doc(`coaches/${id}`), {
      displayName: name,
      identityProvenance:
        id === aliasSurvivorId ? "operator_verified" : "provider",
      ...(id === aliasSourceId
        ? { externalProvider: "api-football", externalProviderId: "90001" }
        : {}),
      createdAt: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
      updatedAt: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
    });
  }
  for (const [id, teamId, matchId] of [
    [targetId, clubs.herediano.teamId, "older-valid"],
    [aliasSourceId, clubs.herediano.teamId, "alias-source"],
    [bothId, clubs.herediano.teamId, "both-home"],
    [bothId, clubs.saprissa.teamId, "both-away"],
  ]) {
    batch.set(database.doc(`matches/${matchId}/coachAssignments/head-coach`), {
      coachId: id,
      teamId,
      matchId,
    });
  }
  batch.set(
    database.doc(
      `coachProviderAliases/${coachProviderAliasId("api-football", "90001")}`,
    ),
    {
      canonicalCoachId: aliasSurvivorId,
      externalProvider: "api-football",
      externalProviderCoachId: "90001",
    },
  );
  await batch.commit();
});

afterAll(() => deleteApp(app));

describe("indexed match coach discovery", () => {
  it("requires explicit preparation and has a zero-write dry run", async () => {
    await expect(
      searchIndexedCoaches(database, clubs.herediano.teamId, "team", ""),
    ).rejects.toBeInstanceOf(CoachSearchIndexIncompleteError);
    const before = (await database.doc(`coaches/${targetId}`).get()).data();
    const plan = await runCoachSearchBackfill(database, false);
    expect(plan).toMatchObject({
      coachesScanned: 172,
      blockingIssues: 0,
      indexStatus: "complete",
      writes: 0,
    });
    expect((await database.doc(`coaches/${targetId}`).get()).data()).toEqual(
      before,
    );
    expect((await database.doc("coachSearchIndex/state").get()).exists).toBe(
      false,
    );
    expect((await runCoachSearchBackfill(database, true)).indexStatus).toBe(
      "complete",
    );
  });

  it("reaches an older valid coach beyond 100 newer foreign records", async () => {
    const globalFirstHundred = await database
      .collection("coaches")
      .orderBy("updatedAt", "desc")
      .limit(100)
      .get();
    expect(globalFirstHundred.docs.some((doc) => doc.id === targetId)).toBe(
      false,
    );
    const service = new AdminConsoleService(
      database,
      undefined,
      undefined,
      observe,
    );
    const matched = await service.searchCoaches(
      heredianoMatchId,
      clubs.herediano.teamId,
      fixtureId,
      "team",
      "alvaro",
    );
    expect(matched?.coaches).toContainEqual(
      expect.objectContaining({ id: targetId, name: "Álvaro Entrenador" }),
    );
    expect(
      reads.find((read) => read.kind === "coach_query")?.documents,
    ).toBeLessThanOrEqual(21);
    expect(reads.some((read) => read.kind === "alias_lookup")).toBe(true);
    const identityPage = await new AdminCoachIdentityService(database).search(
      clubs.herediano.teamId,
      "alvaro",
    );
    expect(identityPage.coaches).toContainEqual(
      expect.objectContaining({ id: targetId, name: "Álvaro Entrenador" }),
    );
  });

  it("paginates selected-Team results without duplicates or foreign-only coaches", async () => {
    reads.length = 0;
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = await searchIndexedCoaches(
        database,
        clubs.herediano.teamId,
        "team",
        "",
        cursor,
        observe,
      );
      ids.push(...page.coaches.map((coach) => coach.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(targetId);
    expect(ids).toContain(aliasSurvivorId);
    expect(ids).toContain(bothId);
    expect(ids).not.toContain(aliasSourceId);
    expect(ids).not.toContain("coach-foreign-000");
    expect(
      reads.filter((read) => read.kind === "coach_query").length,
    ).toBeGreaterThan(2);
    expect(reads.every((read) => read.documents <= 21)).toBe(true);
    const away = await searchIndexedCoaches(
      database,
      clubs.saprissa.teamId,
      "team",
      "compartido",
    );
    expect(away.coaches.map((coach) => coach.id)).toEqual([bothId]);
    const repeated = await searchIndexedCoaches(
      database,
      clubs.herediano.teamId,
      "team",
      "director",
    );
    expect(repeated.coaches.map((coach) => coach.id)).toContain(
      "coach-team-000",
    );
    const foreignFirst = await searchIndexedCoaches(
      database,
      clubs.herediano.teamId,
      "identity",
      "rival",
    );
    expect(foreignFirst.coaches).toEqual([]);
    expect(foreignFirst.nextCursor).toBeDefined();
    let next = (
      await searchIndexedCoaches(
        database,
        clubs.herediano.teamId,
        "identity",
        "director",
      )
    ).nextCursor;
    let reachedTeamCoach = false;
    while (next) {
      const page = await searchIndexedCoaches(
        database,
        clubs.herediano.teamId,
        "identity",
        "director",
        next,
      );
      reachedTeamCoach ||= page.coaches.some(
        (coach) => coach.id === "coach-team-000",
      );
      next = page.nextCursor;
    }
    expect(reachedTeamCoach).toBe(true);
  });

  it("keeps Match ownership, exact fixture, unassociated search and cursors safe", async () => {
    const service = new AdminConsoleService(database);
    expect(
      await service.searchCoaches(
        saprissaMatchId,
        clubs.herediano.teamId,
        fixtureId,
        "team",
        "",
      ),
    ).toBeNull();
    expect(
      await service.searchCoaches(
        heredianoMatchId,
        clubs.herediano.teamId,
        "other",
        "team",
        "",
      ),
    ).toBeNull();
    const unassociated = await searchIndexedCoaches(
      database,
      clubs.herediano.teamId,
      "unassociated",
      "sin",
    );
    expect(unassociated.coaches.map((coach) => coach.id)).toEqual([
      unassociatedId,
    ]);
    await expect(
      searchIndexedCoaches(
        database,
        clubs.herediano.teamId,
        "unassociated",
        "",
      ),
    ).rejects.toBeInstanceOf(CoachSearchInvalidInputError);
    const first = await searchIndexedCoaches(
      database,
      clubs.herediano.teamId,
      "team",
      "",
    );
    await expect(
      searchIndexedCoaches(
        database,
        clubs.saprissa.teamId,
        "team",
        "",
        first.nextCursor,
      ),
    ).rejects.toBeInstanceOf(CoachSearchInvalidInputError);
    await expect(
      searchIndexedCoaches(
        database,
        clubs.herediano.teamId,
        "team",
        "otro",
        first.nextCursor,
      ),
    ).rejects.toBeInstanceOf(CoachSearchInvalidInputError);
    await expect(
      searchIndexedCoaches(
        database,
        clubs.herediano.teamId,
        "team",
        "",
        "bad-cursor",
      ),
    ).rejects.toBeInstanceOf(CoachSearchInvalidInputError);
  });

  it("does not present an incomplete search index as an empty catalog", async () => {
    await database.doc("coachSearchIndex/state").update({
      status: "incomplete",
      blockingIssueCount: 1,
    });
    await expect(
      searchIndexedCoaches(database, clubs.herediano.teamId, "team", ""),
    ).rejects.toBeInstanceOf(CoachSearchIndexIncompleteError);
  });
});
