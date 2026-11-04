import { randomBytes } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { COACH_SEARCH_INDEX_VERSION } from "@/application/coach-search";
import { coachProviderAliasId } from "@/domain/coach-identity";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import type {
  FootballDataProvider,
  ProviderFixtureCatalog,
} from "@/domain/ports";
import { AdminCatalogImportService } from "@/lib/firebase/admin-catalog-import";
import { searchIndexedCoaches } from "@/lib/firebase/coach-search-index";
import { searchIndexedTeamPlayers } from "@/lib/firebase/team-player-membership-index";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import { hashAdminCatalogAction } from "@/lib/server/admin-catalog-action";

const app = initializeApp(
  { projectId: process.env.GCLOUD_PROJECT ?? "demo-rating-app-local" },
  `catalog-import-${Date.now()}`,
);
const database = getFirestore(app);
let serial = 0;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
});
afterAll(() => deleteApp(app));

function catalog(teamExternalId: string): ProviderFixtureCatalog[] {
  const fixtures = [
    {
      id: "1551714",
      kickoffAt: "2026-11-01T22:00:00.000Z",
      competitionName: "Primera División",
    },
    {
      id: "1640753",
      kickoffAt: "2026-10-29T00:30:00.000Z",
      competitionName: "Copa Centroamericana",
    },
  ];
  return fixtures.map(({ id, kickoffAt, competitionName }) => ({
    fixture: {
      externalFixtureId: id,
      externalCompetitionId: id === "1551714" ? "162" : "1028",
      providerSeason: 2026,
      kickoffAt,
      status: "finished",
      homeTeam: { externalProviderId: teamExternalId, name: "Selected" },
      awayTeam: { externalProviderId: "900", name: "Opponent" },
      score: { home: 2, away: 1 },
    },
    competitionName,
    lineupStatus: "available",
    excludedPlayerCount: 0,
    players: Array.from({ length: 25 }, (_, index) => ({
      externalTeamId: teamExternalId,
      externalPlayerId: String(915000 + index),
      name: `Catalog Player ${String(index).padStart(2, "0")}`,
      squadRole: index < 11 ? ("starter" as const) : ("substitute" as const),
      participated: index < 11,
    })),
    coach: {
      status: "resolved" as const,
      value: {
        externalTeamId: teamExternalId,
        externalCoachId: "916000",
        name: "Historical Coach",
      },
    },
  }));
}

function aliasCatalog(observedIds: string[]): ProviderFixtureCatalog[] {
  return catalog("816").map((fixture, index) => ({
    ...fixture,
    players: [
      {
        ...fixture.players[0],
        externalPlayerId: observedIds[index],
        name: "Canonical Player",
      },
    ],
    coach: { status: "unavailable", reason: "coach-missing" },
  }));
}

async function seed(teamId: string, externalTeamId: string) {
  const now = Timestamp.now();
  await Promise.all([
    database.doc(`teams/${teamId}`).set({
      displayName: teamId,
      shortName: teamId,
      countryName: "Costa Rica",
      countryCode: "CR",
      brandingKey: "test",
      externalProviderId: externalTeamId,
      createdAt: now,
      updatedAt: now,
    }),
    database.doc(`teams/${teamId}/playerMembershipIndex/state`).set({
      teamId,
      status: "complete",
      schemaVersion: 1,
      blockingIssueCount: 0,
      baselineMembershipCount: 0,
      auditedAt: now,
    }),
    database.doc("coachSearchIndex/state").set({
      status: "complete",
      schemaVersion: COACH_SEARCH_INDEX_VERSION,
      blockingIssueCount: 0,
      auditedAt: now,
    }),
  ]);
}

function provider(fixtures: ProviderFixtureCatalog[]) {
  return {
    name: "api-football",
    requestCount: 3,
    getRecentFixtureCatalog: async () => fixtures,
  } as unknown as FootballDataProvider;
}

async function authorize(
  action: Awaited<ReturnType<AdminCatalogImportService["preview"]>>["action"],
  operatorUid: string,
) {
  const token = randomBytes(32).toString("base64url");
  await database
    .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
    .set({
      operatorUid,
      resourceId: action.trackedTeamId,
      actionHash: hashAdminCatalogAction(action),
      expiresAt: Timestamp.fromMillis(Date.now() + 120_000),
      createdAt: Timestamp.now(),
    });
  return token;
}

describe("recent-fixture preparation catalog import", () => {
  it.each([
    ["deportivo-saprissa", "816"],
    ["club-sport-herediano", "815"],
  ])(
    "imports %s identities into real indexed selectors without Match effects",
    async (baseTeamId, externalTeamId) => {
      const suffix = ++serial;
      const teamId = `${baseTeamId}-catalog-${suffix}`;
      const operatorUid = `owner-catalog-${suffix}`;
      const matchId = `match-catalog-protected-${suffix}`;
      await seed(teamId, externalTeamId);
      const protectedMatch = {
        trackedTeamId: teamId,
        status: "finished",
        ratingState: "rating_closed",
        votingOpensAt: "2026-11-01T23:00:00.000Z",
        votingClosesAt: "2026-11-02T01:00:00.000Z",
      };
      await database.doc(`matches/${matchId}`).set(protectedMatch);
      await database.doc(`matches/${matchId}/lineupDrafts/${operatorUid}`).set({
        ownerId: operatorUid,
        participants: [{ playerId: "untouched" }],
      });
      await database
        .doc(`matches/${matchId}/participants/untouched`)
        .set({ playerId: "untouched", participated: true });
      await database
        .doc(`matches/${matchId}/verifiedLineups/current`)
        .set({ marker: "untouched" });
      await database
        .doc(`matches/${matchId}/coachAssignments/head-coach`)
        .set({ coachId: "untouched" });
      await database
        .doc(`matches/${matchId}/ballots/voter`)
        .set({ playerRatings: { untouched: 8 } });
      await database
        .doc(`matches/${matchId}/results/summary`)
        .set({ status: "final", marker: "untouched" });
      const protectedPaths = [
        `matches/${matchId}`,
        `matches/${matchId}/lineupDrafts/${operatorUid}`,
        `matches/${matchId}/participants/untouched`,
        `matches/${matchId}/verifiedLineups/current`,
        `matches/${matchId}/coachAssignments/head-coach`,
        `matches/${matchId}/ballots/voter`,
        `matches/${matchId}/results/summary`,
      ];
      const before = (
        await database.getAll(
          ...protectedPaths.map((path) => database.doc(path)),
        )
      ).map((snapshot) => snapshot.data());
      const service = new AdminCatalogImportService(database);
      const { action, plan } = await service.preview(
        teamId,
        operatorUid,
        provider(catalog(externalTeamId)),
      );
      expect(plan).toMatchObject({
        playerCount: 25,
        coachCount: 1,
        newPlayers: baseTeamId === "deportivo-saprissa" ? 25 : 0,
        newCoaches: baseTeamId === "deportivo-saprissa" ? 1 : 0,
        providerRequests: 3,
        previewDocumentReads: 110,
        canApply: true,
      });
      expect(
        (
          await database.getAll(
            ...protectedPaths.map((path) => database.doc(path)),
          )
        ).map((snapshot) => snapshot.data()),
      ).toEqual(before);
      expect(
        (await searchIndexedTeamPlayers(database, teamId, "")).players,
      ).toHaveLength(0);
      const token = await authorize(action, operatorUid);
      const applied = await service.applyAuthorized(action, operatorUid, token);
      expect(applied.disposition).toBe("applied");
      expect(
        await service.applyAuthorized(action, operatorUid, token),
      ).toMatchObject({
        auditId: applied.auditId,
        disposition: "idempotent_retry",
      });
      const first = await searchIndexedTeamPlayers(database, teamId, "");
      const second = await searchIndexedTeamPlayers(
        database,
        teamId,
        "",
        first.nextCursor,
      );
      expect(first.players).toHaveLength(20);
      expect(second.players).toHaveLength(5);
      expect(
        (await searchIndexedTeamPlayers(database, teamId, "catalog player 24"))
          .players,
      ).toHaveLength(1);
      expect(
        (await searchIndexedCoaches(database, teamId, "team", "")).coaches,
      ).toMatchObject([{ name: "Historical Coach" }]);
      expect(
        (
          await database
            .doc(
              `teams/${teamId}/playerMemberships/${providerEntityId("player", "api-football", "915011")}`,
            )
            .get()
        ).data(),
      ).toMatchObject({
        source: "fixture_catalog",
        sourceFixtureIds: ["1551714", "1640753"],
      });
      expect(
        (
          await database.getAll(
            ...protectedPaths.map((path) => database.doc(path)),
          )
        ).map((snapshot) => snapshot.data()),
      ).toEqual(before);
    },
  );

  it("keeps reviewed operator survivors and rejects stale plans atomically", async () => {
    const teamId = `team-catalog-alias-${++serial}`;
    const operatorUid = `owner-alias-${serial}`;
    await seed(teamId, "816");
    const canonicalPlayerId = `player-internal-${"a".repeat(32)}`;
    const canonicalCoachId = "coach-operator-catalog";
    await database.doc(`players/${canonicalPlayerId}`).set({
      displayName: "Verified Player",
      identityProvenance: "operator_verified",
      currentTeamId: "other-club",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await database.doc(`coaches/${canonicalCoachId}`).set({
      displayName: "Verified Coach",
      identityProvenance: "operator_verified",
      associatedTeamIds: ["other-club"],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", "915000")}`,
      )
      .set({
        canonicalPlayerId,
        externalProvider: "api-football",
        externalProviderPlayerId: "915000",
        canonicalExternalProviderPlayerId: "915000",
      });
    await database
      .doc(
        `coachProviderAliases/${coachProviderAliasId("api-football", "916000")}`,
      )
      .set({
        canonicalCoachId,
        externalProvider: "api-football",
        externalProviderCoachId: "916000",
      });
    const retainedPlayerRef = database.doc(
      `players/${providerEntityId("player", "api-football", "915000")}`,
    );
    const retainedCoachRef = database.doc(
      `coaches/${providerEntityId("coach", "api-football", "916000")}`,
    );
    const retainedBefore = (
      await database.getAll(retainedPlayerRef, retainedCoachRef)
    ).map((snapshot) => snapshot.data());
    const service = new AdminCatalogImportService(database);
    const { action } = await service.preview(
      teamId,
      operatorUid,
      provider(catalog("816")),
    );
    expect(action.players.some(({ id }) => id === canonicalPlayerId)).toBe(
      true,
    );
    expect(action.coaches).toMatchObject([{ id: canonicalCoachId }]);
    const token = await authorize(action, operatorUid);
    await database
      .doc(`players/${providerEntityId("player", "api-football", "915001")}`)
      .set({
        displayName: "Concurrent change",
        identityProvenance: "provider",
        externalProvider: "api-football",
        externalProviderId: "915001",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    await expect(
      service.applyAuthorized(action, operatorUid, token),
    ).rejects.toMatchObject({ code: "stale" });
    expect(
      (
        await database
          .doc(`teams/${teamId}/playerMemberships/${canonicalPlayerId}`)
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (
        await database
          .doc(`adminAudit/catalog-import-${adminChallengeDocumentId(token)}`)
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (await database.doc(`players/${canonicalPlayerId}`).get()).data(),
    ).toMatchObject({
      displayName: "Verified Player",
      currentTeamId: "other-club",
    });
    const refreshed = await service.preview(
      teamId,
      `${operatorUid}-retry`,
      provider(catalog("816")),
    );
    await service.applyAuthorized(
      refreshed.action,
      `${operatorUid}-retry`,
      await authorize(refreshed.action, `${operatorUid}-retry`),
    );
    expect(
      (await database.doc(`players/${canonicalPlayerId}`).get()).data(),
    ).toMatchObject({
      displayName: "Verified Player",
      currentTeamId: "other-club",
      identityProvenance: "operator_verified",
    });
    expect(
      (await database.doc(`coaches/${canonicalCoachId}`).get()).data(),
    ).toMatchObject({
      displayName: "Verified Coach",
      identityProvenance: "operator_verified",
      associatedTeamIds: ["other-club", teamId],
    });
    expect(
      (await database.getAll(retainedPlayerRef, retainedCoachRef)).map(
        (snapshot) => snapshot.data(),
      ),
    ).toEqual(retainedBefore);
    expect(
      (
        await database
          .doc(`teams/${teamId}/playerMemberships/${canonicalPlayerId}`)
          .get()
      ).data(),
    ).toMatchObject({ source: "fixture_catalog" });
    const repeated = await service.preview(
      teamId,
      `${operatorUid}-again`,
      provider(catalog("816")),
    );
    expect(repeated.plan).toMatchObject({
      newPlayers: 0,
      newCoaches: 0,
      proposedWrites: 2,
    });
  });

  it("preserves a provider-origin survivor when a different observed alias is imported", async () => {
    const teamId = `team-catalog-provider-alias-${++serial}`;
    const operatorUid = `owner-provider-alias-${serial}`;
    const canonicalExternalId = "985100";
    const observedExternalId = "985200";
    const canonicalPlayerId = providerEntityId(
      "player",
      "api-football",
      canonicalExternalId,
    );
    const retainedPlayerRef = database.doc(
      `players/${providerEntityId("player", "api-football", observedExternalId)}`,
    );
    const aliasRef = database.doc(
      `playerProviderAliases/${playerProviderAliasId("api-football", observedExternalId)}`,
    );
    await seed(teamId, "816");
    await database.doc(`players/${canonicalPlayerId}`).set({
      displayName: "Canonical Player",
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: canonicalExternalId,
      currentTeamId: "another-club",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await retainedPlayerRef.set({
      displayName: "Retained losing Player",
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: observedExternalId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await aliasRef.set({
      canonicalPlayerId,
      canonicalExternalProviderPlayerId: canonicalExternalId,
      externalProvider: "api-football",
      externalProviderPlayerId: observedExternalId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    const protectedBefore = (
      await database.getAll(retainedPlayerRef, aliasRef)
    ).map((snapshot) => snapshot.data());
    const service = new AdminCatalogImportService(database);
    const { action, plan } = await service.preview(
      teamId,
      operatorUid,
      provider(aliasCatalog([observedExternalId, observedExternalId])),
    );
    expect(action.players).toMatchObject([
      {
        id: canonicalPlayerId,
        canonicalExternalId,
        observedExternalIds: [observedExternalId],
      },
    ]);
    expect(plan).toMatchObject({
      playerCount: 1,
      newPlayers: 0,
      metadataChanges: 0,
    });
    const token = await authorize(action, operatorUid);
    const applied = await service.applyAuthorized(action, operatorUid, token);
    expect(applied.disposition).toBe("applied");
    expect(
      await service.applyAuthorized(action, operatorUid, token),
    ).toMatchObject({
      auditId: applied.auditId,
      disposition: "idempotent_retry",
    });
    expect(
      (await database.doc(`players/${canonicalPlayerId}`).get()).data(),
    ).toMatchObject({
      externalProviderId: canonicalExternalId,
      currentTeamId: "another-club",
    });
    expect(
      (
        await database
          .doc(`teams/${teamId}/playerMemberships/${canonicalPlayerId}`)
          .get()
      ).data(),
    ).toMatchObject({
      source: "fixture_catalog",
      sourceFixtureIds: ["1551714", "1640753"],
    });
    expect(
      (await searchIndexedTeamPlayers(database, teamId, "canonical player"))
        .players,
    ).toMatchObject([{ player: { id: canonicalPlayerId } }]);
    expect(
      (await database.getAll(retainedPlayerRef, aliasRef)).map((snapshot) =>
        snapshot.data(),
      ),
    ).toEqual(protectedBefore);
    const repeated = await service.preview(
      teamId,
      `${operatorUid}-again`,
      provider(aliasCatalog([observedExternalId, observedExternalId])),
    );
    expect(repeated.plan).toMatchObject({
      proposedWrites: 2,
      metadataChanges: 0,
    });
    expect(repeated.action.players[0].canonicalExternalId).toBe(
      canonicalExternalId,
    );
  });

  it("collapses multiple aliases without depending on fixture order and rejects conflicting declarations", async () => {
    const teamId = `team-catalog-multiple-alias-${++serial}`;
    const canonicalExternalId = "986100";
    const canonicalPlayerId = providerEntityId(
      "player",
      "api-football",
      canonicalExternalId,
    );
    const observedIds = ["986200", "986300"];
    await seed(teamId, "816");
    await database.doc(`players/${canonicalPlayerId}`).set({
      displayName: "Canonical Player",
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: canonicalExternalId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    for (const observedExternalId of observedIds)
      await database
        .doc(
          `playerProviderAliases/${playerProviderAliasId("api-football", observedExternalId)}`,
        )
        .set({
          canonicalPlayerId,
          canonicalExternalProviderPlayerId: canonicalExternalId,
          externalProvider: "api-football",
          externalProviderPlayerId: observedExternalId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
    const service = new AdminCatalogImportService(database);
    const source = aliasCatalog(observedIds).map((fixture, index) => ({
      ...fixture,
      players: [{ ...fixture.players[0], name: `Observed Alias ${index}` }],
    }));
    const first = await service.preview(
      teamId,
      `owner-multiple-first-${serial}`,
      provider(source),
    );
    const reversed = await service.preview(
      teamId,
      `owner-multiple-reversed-${serial}`,
      provider([...source].reverse()),
    );
    expect(first.action.players).toEqual(reversed.action.players);
    expect(first.action.players).toMatchObject([
      {
        id: canonicalPlayerId,
        canonicalExternalId,
        observedExternalIds: observedIds,
      },
    ]);
    await service.applyAuthorized(
      first.action,
      `owner-multiple-first-${serial}`,
      await authorize(first.action, `owner-multiple-first-${serial}`),
    );
    expect(
      (await database.doc(`players/${canonicalPlayerId}`).get()).data(),
    ).toMatchObject({ externalProviderId: canonicalExternalId });
    expect(
      (await database.collection(`teams/${teamId}/playerMemberships`).get())
        .size,
    ).toBe(1);
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", observedIds[1])}`,
      )
      .update({ canonicalExternalProviderPlayerId: "986999" });
    await expect(
      service.preview(
        teamId,
        `owner-multiple-conflict-${serial}`,
        provider(source),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await database.collection(`teams/${teamId}/playerMemberships`).get())
        .size,
    ).toBe(1);
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", observedIds[1])}`,
      )
      .update({ canonicalExternalProviderPlayerId: canonicalExternalId });
    await database
      .doc(`players/${canonicalPlayerId}`)
      .update({ externalProviderId: "986999" });
    await expect(
      service.preview(
        teamId,
        `owner-survivor-conflict-${serial}`,
        provider(source),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects a reviewed alias whose canonical Player is missing", async () => {
    const teamId = `team-catalog-missing-survivor-${++serial}`;
    const canonicalPlayerId = providerEntityId(
      "player",
      "api-football",
      "988100",
    );
    await seed(teamId, "816");
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", "988200")}`,
      )
      .set({
        canonicalPlayerId,
        canonicalExternalProviderPlayerId: "988100",
        externalProvider: "api-football",
        externalProviderPlayerId: "988200",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    const service = new AdminCatalogImportService(database);
    await expect(
      service.preview(
        teamId,
        `owner-missing-survivor-${serial}`,
        provider(aliasCatalog(["988200", "988200"])),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await database
          .doc(`teams/${teamId}/playerMemberships/${canonicalPlayerId}`)
          .get()
      ).exists,
    ).toBe(false);
    await database.doc(`players/${canonicalPlayerId}`).set({
      displayName: "Intermediate Player",
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: "988100",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", "988100")}`,
      )
      .set({
        canonicalPlayerId: providerEntityId("player", "api-football", "988300"),
        canonicalExternalProviderPlayerId: "988300",
        externalProvider: "api-football",
        externalProviderPlayerId: "988100",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    await expect(
      service.preview(
        teamId,
        `owner-alias-chain-${serial}`,
        provider(aliasCatalog(["988200", "988200"])),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects alias changes after preview without consuming the authorization", async () => {
    const teamId = `team-catalog-stale-alias-${++serial}`;
    const canonicalExternalId = "987100";
    const observedExternalId = "987200";
    const canonicalPlayerId = providerEntityId(
      "player",
      "api-football",
      canonicalExternalId,
    );
    const aliasRef = database.doc(
      `playerProviderAliases/${playerProviderAliasId("api-football", observedExternalId)}`,
    );
    await seed(teamId, "816");
    await database.doc(`players/${canonicalPlayerId}`).set({
      displayName: "Canonical Player",
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: canonicalExternalId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await aliasRef.set({
      canonicalPlayerId,
      canonicalExternalProviderPlayerId: canonicalExternalId,
      externalProvider: "api-football",
      externalProviderPlayerId: observedExternalId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    const service = new AdminCatalogImportService(database);
    const { action } = await service.preview(
      teamId,
      `owner-stale-${serial}`,
      provider(aliasCatalog([observedExternalId, observedExternalId])),
    );
    const token = await authorize(action, `owner-stale-${serial}`);
    await expect(
      service.applyAuthorized(
        {
          ...action,
          players: action.players.map((player) => ({
            ...player,
            canonicalExternalId: "987999",
          })),
        },
        `owner-stale-${serial}`,
        token,
      ),
    ).rejects.toMatchObject({ code: "authorization" });
    await aliasRef.update({ canonicalExternalProviderPlayerId: "987999" });
    await expect(
      service.applyAuthorized(action, `owner-stale-${serial}`, token),
    ).rejects.toMatchObject({ code: "stale" });
    expect(
      (
        await database
          .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
          .get()
      ).data(),
    ).not.toHaveProperty("consumedAt");
    expect(
      (
        await database
          .doc(`adminAudit/catalog-import-${adminChallengeDocumentId(token)}`)
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (
        await database
          .doc(`teams/${teamId}/playerMemberships/${canonicalPlayerId}`)
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (await database.doc(`players/${canonicalPlayerId}`).get()).data(),
    ).toMatchObject({ externalProviderId: canonicalExternalId });
  });

  it("requires complete search indexes before any provider lookup", async () => {
    const teamId = `team-catalog-incomplete-${++serial}`;
    await seed(teamId, "816");
    await database
      .doc(`teams/${teamId}/playerMembershipIndex/state`)
      .update({ status: "incomplete" });
    const getRecentFixtureCatalog = vi.fn().mockResolvedValue(catalog("816"));
    const service = new AdminCatalogImportService(database);
    await expect(
      service.preview(teamId, `owner-${serial}`, {
        name: "api-football",
        requestCount: 0,
        getRecentFixtureCatalog,
      } as unknown as FootballDataProvider),
    ).rejects.toMatchObject({ code: "index_incomplete" });
    expect(getRecentFixtureCatalog).not.toHaveBeenCalled();
  });

  it("rejects an expired challenge without importing a Player or writing success audit", async () => {
    const teamId = `team-catalog-expired-${++serial}`;
    const operatorUid = `owner-expired-${serial}`;
    await seed(teamId, "816");
    const service = new AdminCatalogImportService(database);
    const { action } = await service.preview(
      teamId,
      operatorUid,
      provider(catalog("816")),
    );
    const token = await authorize(action, operatorUid);
    await database
      .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
      .update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await expect(
      service.applyAuthorized(action, operatorUid, token),
    ).rejects.toMatchObject({ code: "authorization" });
    expect(
      (
        await database
          .doc(
            `teams/${teamId}/playerMemberships/${providerEntityId("player", "api-football", "915024")}`,
          )
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (
        await database
          .doc(`adminAudit/catalog-import-${adminChallengeDocumentId(token)}`)
          .get()
      ).exists,
    ).toBe(false);
  });
});
