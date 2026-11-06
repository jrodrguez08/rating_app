import { createHmac, randomBytes, scryptSync } from "node:crypto";

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
  ProviderSquadPlayer,
} from "@/domain/ports";
import { AdminCatalogImportService } from "@/lib/firebase/admin-catalog-import";
import { AdminSecurityStore } from "@/lib/firebase/admin-security";
import { searchIndexedCoaches } from "@/lib/firebase/coach-search-index";
import { AdminPlayerHistoryService } from "@/lib/firebase/server";
import { searchIndexedTeamPlayers } from "@/lib/firebase/team-player-membership-index";
import { ProviderError } from "@/lib/providers/api-football/errors";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import {
  hashAdminCatalogAction,
  parseAdminCatalogAction,
} from "@/lib/server/admin-catalog-action";

import { measureReads } from "./read-counts";

const app = initializeApp(
  { projectId: "demo-rating-app-catalog-import-tests" },
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

function provider(
  fixtures: ProviderFixtureCatalog[],
  squad: ProviderSquadPlayer[] = [],
) {
  return {
    name: "api-football",
    requestCount: 4,
    getRecentFixtureCatalog: async () => fixtures,
    getSquad: async () => squad,
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
  it("accounts for preview, enrichment, apply and unchanged re-import reads", async () => {
    const teamId = `team-search-audit-${++serial}`;
    const owner = `owner-search-audit-${serial}`;
    await seed(teamId, "816");
    const fixtures = catalog("816").map((fixture) => ({
      ...fixture,
      players: fixture.players.map((player, index) => ({
        ...player,
        externalPlayerId: String(995500 + index),
      })),
      coach: {
        status: "resolved" as const,
        value: {
          externalTeamId: "816",
          externalCoachId: "995999",
          name: "Catalog Audit Coach",
        },
      },
    }));
    const squad = fixtures[0].players.map((player) => ({
      externalPlayerId: player.externalPlayerId,
      name: player.name,
      position: "midfielder" as const,
      photoUrl: `https://media.api-sports.io/football/players/${player.externalPlayerId}.png`,
    }));
    const service = new AdminCatalogImportService(database);
    const preview = await measureReads(() =>
      service.preview(teamId, owner, provider(fixtures, squad)),
    );
    expect(preview.documents).toBeLessThanOrEqual(110);
    expect(preview.queries).toBe(0);
    const token = await authorize(preview.value.action, owner);
    const apply = await measureReads(() =>
      service.applyAuthorized(preview.value.action, owner, token),
    );
    expect(apply.documents).toBe(81);
    const retry = await measureReads(() =>
      service.applyAuthorized(preview.value.action, owner, token),
    );
    expect(retry.documents).toBe(2);
    for (let index = 0; index < 2; index++) {
      const repeated = await measureReads(() =>
        service.preview(
          teamId,
          `${owner}-repeat-${index}`,
          provider(fixtures, squad),
        ),
      );
      expect(repeated.documents).toBeLessThanOrEqual(110);
      expect(repeated.queries).toBe(0);
      expect(repeated.value.plan).toMatchObject({
        newPlayers: 0,
        newCoaches: 0,
        positionFills: 0,
        photoFills: 0,
      });
      const repeatOwner = `${owner}-repeat-${index}`;
      const repeatToken = await authorize(repeated.value.action, repeatOwner);
      const reapplied = await measureReads(() =>
        service.applyAuthorized(
          repeated.value.action,
          repeatOwner,
          repeatToken,
        ),
      );
      expect(reapplied.documents).toBe(81);
      expect(reapplied.value.plan).toMatchObject({
        newPlayers: 0,
        newCoaches: 0,
        positionFills: 0,
        photoFills: 0,
      });
    }
  });

  it("authorizes and applies a transported real preview with a synthetic passphrase", async () => {
    const teamId = `team-catalog-roundtrip-${++serial}`;
    const owner = `owner-roundtrip-${serial}`;
    const externalTeamId = String(800_000 + serial);
    const passphrase = "synthetic catalog passphrase 2026";
    const previousDigest = process.env.ADMIN_PASSPHRASE_SCRYPT;
    const salt = randomBytes(16);
    const digest = scryptSync(passphrase, salt, 32, {
      N: 16_384,
      r: 8,
      p: 1,
    });
    process.env.ADMIN_PASSPHRASE_SCRYPT = `scrypt$v1$16384$8$1$${salt.toString("base64")}$${digest.toString("base64")}`;
    try {
      await seed(teamId, externalTeamId);
      const service = new AdminCatalogImportService(database);
      const security = new AdminSecurityStore(database);
      const fixtures = catalog(externalTeamId).map((fixture) => ({
        ...fixture,
        players: fixture.players.map((player, index) => ({
          ...player,
          externalPlayerId: String(8_000_000 + serial * 100 + index),
        })),
        coach: {
          status: "resolved" as const,
          value: {
            externalTeamId,
            externalCoachId: String(8_100_000 + serial),
            name: "Synthetic Roundtrip Coach",
          },
        },
      }));
      const photoExternalId = String(8_000_000 + serial * 100);
      const photoPlayerId = providerEntityId(
        "player",
        "api-football",
        photoExternalId,
      );
      const photoUrl = `https://media.api-sports.io/football/players/${photoExternalId}.png`;
      await database.doc(`players/${photoPlayerId}`).set({
        displayName: "Catalog Player 00",
        identityProvenance: "provider",
        externalProvider: "api-football",
        externalProviderId: photoExternalId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      const squad = [
        {
          externalPlayerId: photoExternalId,
          name: "Catalog Player 00",
          photoUrl,
        },
        {
          externalPlayerId: String(8_900_000 + serial),
          name: "Squad Only",
          photoUrl: "https://media.api-sports.io/football/players/8900001.png",
        },
      ];
      const { action, plan } = await service.preview(
        teamId,
        owner,
        provider(fixtures, squad),
      );
      expect(plan.canApply).toBe(true);
      expect(plan).toMatchObject({ photoFills: 1, providerRequests: 4 });
      expect(plan.players).toContainEqual(
        expect.objectContaining({
          name: "Catalog Player 00",
          proposedPhotoUrl: photoUrl,
          photoStatus: "fill",
        }),
      );
      expect(
        action.players.find((player) => player.id === photoPlayerId),
      ).toMatchObject({
        photoUrl,
        photoConflict: false,
      });
      const preview = await security.issuePreview(owner, action);
      const transported = parseAdminCatalogAction(
        JSON.parse(JSON.stringify(action)) as unknown,
      );
      expect(hashAdminCatalogAction(transported)).toBe(
        hashAdminCatalogAction(action),
      );
      expect(() =>
        parseAdminCatalogAction({
          ...transported,
          players: transported.players.map((player) =>
            player.id === photoPlayerId
              ? { ...player, photoUrl: "https://example.com/untrusted.png" }
              : player,
          ),
        }),
      ).toThrow("La foto del jugador no es válida.");
      const rearranged = parseAdminCatalogAction({
        ...transported,
        fixtures: transported.fixtures.map((fixture) => ({
          coachStatus: fixture.coachStatus,
          excludedPlayerCount: fixture.excludedPlayerCount,
          lineupStatus: fixture.lineupStatus,
          competitionName: fixture.competitionName,
          kickoffAt: fixture.kickoffAt,
          id: fixture.id,
        })),
        players: transported.players.map((player) => ({
          sourceFixtureIds: player.sourceFixtureIds,
          positionConflict: player.positionConflict,
          photoConflict: player.photoConflict,
          photoUrl: player.photoUrl,
          positionSource: player.positionSource,
          position: player.position,
          name: player.name,
          squadExternalIds: player.squadExternalIds,
          observedExternalIds: player.observedExternalIds,
          canonicalExternalId: player.canonicalExternalId,
          id: player.id,
        })),
        coaches: transported.coaches.map((coach) => ({
          sourceFixtureIds: coach.sourceFixtureIds,
          photoUrl: coach.photoUrl,
          name: coach.name,
          observedExternalIds: coach.observedExternalIds,
          externalId: coach.externalId,
          id: coach.id,
        })),
      });
      expect(hashAdminCatalogAction(rearranged)).toBe(
        hashAdminCatalogAction(action),
      );
      for (const changed of [
        { ...transported, trackedTeamId: "other-team" },
        { ...transported, externalTeamId: "817" },
        { ...transported, stateHash: "f".repeat(64) },
        { ...transported, observedAt: "2026-11-04T12:00:00.000Z" },
        {
          ...transported,
          fixtures: [{ ...transported.fixtures[0], id: "999" }],
        },
        {
          ...transported,
          players: [
            { ...transported.players[0], canonicalExternalId: "999" },
            ...transported.players.slice(1),
          ],
        },
        {
          ...transported,
          players: [
            { ...transported.players[0], observedExternalIds: ["999"] },
            ...transported.players.slice(1),
          ],
        },
        {
          ...transported,
          players: transported.players.map((player) =>
            player.id === photoPlayerId
              ? {
                  ...player,
                  photoUrl:
                    "https://media.api-sports.io/football/players/999.png",
                }
              : player,
          ),
        },
        {
          ...transported,
          players: [
            {
              ...transported.players[0],
              position: "goalkeeper" as const,
              positionSource: "lineup" as const,
            },
            ...transported.players.slice(1),
          ],
        },
      ]) {
        expect(hashAdminCatalogAction(changed)).not.toBe(
          hashAdminCatalogAction(action),
        );
        await expect(
          security.authorizeAction({
            operatorUid: owner,
            action: changed,
            previewToken: preview.token,
            passphrase,
          }),
        ).rejects.toMatchObject({ code: "stale_preview" });
      }
      await expect(
        security.authorizeAction({
          operatorUid: `${owner}-other`,
          action: transported,
          previewToken: preview.token,
          passphrase,
        }),
      ).rejects.toMatchObject({ code: "stale_preview" });
      const [payload] = preview.token.split(".");
      const expiredPayload = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        }),
      ).toString("base64url");
      const expiredSignature = createHmac(
        "sha256",
        process.env.ADMIN_PASSPHRASE_SCRYPT!,
      )
        .update(expiredPayload)
        .digest("base64url");
      await expect(
        security.authorizeAction({
          operatorUid: owner,
          action: transported,
          previewToken: `${expiredPayload}.${expiredSignature}`,
          passphrase,
        }),
      ).rejects.toMatchObject({ code: "stale_preview" });
      await expect(
        security.authorizeAction({
          operatorUid: owner,
          action: transported,
          previewToken: preview.token,
          passphrase: "incorrect synthetic passphrase",
        }),
      ).rejects.toMatchObject({ code: "invalid_passphrase" });
      const challenge = await security.authorizeAction({
        operatorUid: owner,
        action: transported,
        previewToken: preview.token,
        passphrase,
      });
      const applied = await service.applyAuthorized(
        parseAdminCatalogAction(JSON.parse(JSON.stringify(transported))),
        owner,
        challenge.token,
      );
      expect(applied.disposition).toBe("applied");
      expect(
        (await database.doc(`players/${photoPlayerId}`).get()).data(),
      ).toMatchObject({
        photoUrl,
        externalProviderId: photoExternalId,
      });
      expect(
        (
          await new AdminPlayerHistoryService(database).get(
            photoPlayerId,
            teamId,
          )
        )?.photoUrl,
      ).toBe(photoUrl);
      expect(
        (
          await database
            .doc(
              `players/${providerEntityId("player", "api-football", squad[1].externalPlayerId)}`,
            )
            .get()
        ).exists,
      ).toBe(false);
      expect(
        (await database.doc(`adminAudit/${applied.auditId}`).get()).exists,
      ).toBe(true);
      const writtenBeforeRetry = await database.collection("players").get();
      expect(
        await service.applyAuthorized(transported, owner, challenge.token),
      ).toMatchObject({
        auditId: applied.auditId,
        disposition: "idempotent_retry",
      });
      expect((await database.collection("players").get()).size).toBe(
        writtenBeforeRetry.size,
      );
      const repeated = await service.preview(
        teamId,
        `${owner}-repeat`,
        provider(fixtures, squad),
      );
      expect(repeated.plan).toMatchObject({
        photoFills: 0,
        proposedWrites: 3,
      });
    } finally {
      if (previousDigest === undefined)
        delete process.env.ADMIN_PASSPHRASE_SCRYPT;
      else process.env.ADMIN_PASSPHRASE_SCRYPT = previousDigest;
    }
  });
  it("fills only reviewed missing positions through canonical candidates", async () => {
    const teamId = `team-catalog-positions-${++serial}`;
    const owner = `owner-positions-${serial}`;
    await seed(teamId, "816");
    const canonicalId = providerEntityId("player", "api-football", "989100");
    const operatorId = `player-internal-${"b".repeat(32)}`;
    const retainedId = providerEntityId("player", "api-football", "989200");
    await database.doc(`players/${canonicalId}`).set({
      displayName: "Canonical Player",
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: "989100",
      currentTeamId: "other-club",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await database.doc(`players/${operatorId}`).set({
      displayName: "Verified Player",
      identityProvenance: "operator_verified",
      currentTeamId: "other-club",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await database.doc(`players/${retainedId}`).set({
      displayName: "Retained Duplicate",
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: "989200",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    const positionedId = providerEntityId("player", "api-football", "989700");
    await database.doc(`players/${positionedId}`).set({
      displayName: "Positioned Player",
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: "989700",
      position: "goalkeeper",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    for (const [observed, id, canonical] of [
      ["989200", canonicalId, "989100"],
      ["989500", operatorId, "989500"],
    ])
      await database
        .doc(
          `playerProviderAliases/${playerProviderAliasId("api-football", observed)}`,
        )
        .set({
          canonicalPlayerId: id,
          externalProvider: "api-football",
          externalProviderPlayerId: observed,
          canonicalExternalProviderPlayerId: canonical,
        });
    const retainedBefore = (
      await database.doc(`players/${retainedId}`).get()
    ).data();
    const fixture = {
      ...catalog("816")[0],
      players: [
        {
          externalTeamId: "816",
          externalPlayerId: "989200",
          name: "Observed Player",
          squadRole: "starter" as const,
          participated: true,
        },
        {
          externalTeamId: "816",
          externalPlayerId: "989300",
          name: "New Player",
          squadRole: "starter" as const,
          participated: true,
        },
        {
          externalTeamId: "816",
          externalPlayerId: "989500",
          name: "Verified Player",
          squadRole: "starter" as const,
          participated: true,
        },
        {
          externalTeamId: "816",
          externalPlayerId: "989600",
          name: "Missing Player",
          squadRole: "starter" as const,
          participated: true,
        },
        {
          externalTeamId: "816",
          externalPlayerId: "989800",
          name: "Conflicting Player",
          position: "defender" as const,
          squadRole: "starter" as const,
          participated: true,
        },
        {
          externalTeamId: "816",
          externalPlayerId: "989700",
          name: "Positioned Player",
          squadRole: "starter" as const,
          participated: true,
        },
      ],
      coach: {
        status: "unavailable" as const,
        reason: "coach-missing" as const,
      },
    };
    const squad: ProviderSquadPlayer[] = [
      {
        externalPlayerId: "989200",
        name: "Observed Player",
        position: "attacker",
      },
      {
        externalPlayerId: "989300",
        name: "New Player",
        position: "midfielder",
      },
      {
        externalPlayerId: "989500",
        name: "Verified Player",
        position: "defender",
      },
      {
        externalPlayerId: "989800",
        name: "Conflicting Player",
        position: "attacker",
      },
      {
        externalPlayerId: "989700",
        name: "Positioned Player",
        position: "attacker",
      },
      {
        externalPlayerId: "989999",
        name: "Squad Only",
        position: "goalkeeper",
      },
    ];
    const service = new AdminCatalogImportService(database);
    const { action, plan } = await service.preview(
      teamId,
      owner,
      provider([fixture], squad),
    );
    expect(plan).toMatchObject({
      playerCount: 6,
      positionFills: 3,
      positionGaps: 2,
      squadPlayers: 6,
      providerRequests: 4,
    });
    expect(plan.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Canonical Player",
          proposedPosition: "attacker",
          positionSource: "squad",
        }),
        expect.objectContaining({
          name: "Verified Player",
          proposedPosition: "defender",
          positionSource: "squad",
        }),
        expect.objectContaining({
          name: "Missing Player",
          positionGap: "missing",
        }),
        expect.objectContaining({
          name: "Positioned Player",
          currentPosition: "goalkeeper",
        }),
        expect.objectContaining({
          name: "Conflicting Player",
          positionGap: "conflict",
        }),
      ]),
    );
    await service.applyAuthorized(
      action,
      owner,
      await authorize(action, owner),
    );
    expect(
      (await database.doc(`players/${canonicalId}`).get()).data(),
    ).toMatchObject({
      position: "attacker",
      externalProviderId: "989100",
      currentTeamId: "other-club",
    });
    expect(
      (await database.doc(`players/${operatorId}`).get()).data(),
    ).toMatchObject({
      position: "defender",
      displayName: "Verified Player",
      currentTeamId: "other-club",
    });
    expect(
      (
        await database
          .doc(
            `players/${providerEntityId("player", "api-football", "989300")}`,
          )
          .get()
      ).data(),
    ).toMatchObject({ position: "midfielder" });
    expect((await database.doc(`players/${retainedId}`).get()).data()).toEqual(
      retainedBefore,
    );
    expect(
      (await database.doc(`players/${positionedId}`).get()).data(),
    ).toMatchObject({
      position: "goalkeeper",
    });
    expect(
      (
        await database
          .doc(
            `players/${providerEntityId("player", "api-football", "989999")}`,
          )
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (await searchIndexedTeamPlayers(database, teamId, "canonical player"))
        .players,
    ).toMatchObject([{ player: { id: canonicalId, position: "attacker" } }]);
    expect(
      (await new AdminPlayerHistoryService(database).get(canonicalId, teamId))
        ?.position,
    ).toBe("attacker");
    const repeated = await service.preview(
      teamId,
      `${owner}-again`,
      provider([fixture], squad),
    );
    expect(repeated.plan).toMatchObject({
      positionFills: 0,
      positionGaps: 2,
      proposedWrites: 2,
    });
  });

  it("keeps catalog identities untouched when the bounded squad lookup fails", async () => {
    const teamId = `team-catalog-squad-error-${++serial}`;
    await seed(teamId, "816");
    const getSquad = vi
      .fn()
      .mockRejectedValue(new ProviderError("rate-limited", "quota"));
    const service = new AdminCatalogImportService(database);
    await expect(
      service.preview(teamId, `owner-squad-error-${serial}`, {
        name: "api-football",
        requestCount: 3,
        getRecentFixtureCatalog: async () => catalog("816"),
        getSquad,
      } as unknown as FootballDataProvider),
    ).rejects.toMatchObject({ code: "rate-limited" });
    expect(getSquad).toHaveBeenCalledWith("816", "catalog");
    expect(
      (
        await database
          .doc(
            `players/${providerEntityId("player", "api-football", "915000")}`,
          )
          .get()
      ).exists,
    ).toBe(false);
  });

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
        providerRequests: 4,
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
    const photoUrl = `https://media.api-sports.io/football/players/${observedExternalId}.png`;
    const squad = [
      {
        externalPlayerId: observedExternalId,
        name: "Canonical Player",
        photoUrl,
      },
    ];
    const { action, plan } = await service.preview(
      teamId,
      operatorUid,
      provider(aliasCatalog([observedExternalId, observedExternalId]), squad),
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
      metadataChanges: 1,
      photoFills: 1,
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
      photoUrl,
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
      provider(aliasCatalog([observedExternalId, observedExternalId]), squad),
    );
    expect(repeated.plan).toMatchObject({
      proposedWrites: 2,
      metadataChanges: 0,
      photoFills: 0,
    });
    expect(repeated.action.players[0].canonicalExternalId).toBe(
      canonicalExternalId,
    );
  });

  it("fills only missing photos and reports unavailable or conflicting squad evidence", async () => {
    const teamId = `team-catalog-photos-${++serial}`;
    const owner = `owner-photos-${serial}`;
    await seed(teamId, "816");
    const storedId = providerEntityId("player", "api-football", "981001");
    const verifiedId = `player-internal-${"c".repeat(32)}`;
    const existingPhoto =
      "https://media.api-sports.io/football/players/777.png";
    const verifiedPhoto =
      "https://media.api-sports.io/football/players/981002.png";
    await database.doc(`players/${storedId}`).set({
      displayName: "Stored Photo",
      identityProvenance: "operator_verified",
      externalProvider: "api-football",
      externalProviderId: "981001",
      photoUrl: existingPhoto,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await database.doc(`players/${verifiedId}`).set({
      displayName: "Verified Player",
      identityProvenance: "operator_verified",
      position: "defender",
      currentTeamId: "other-club",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", "981002")}`,
      )
      .set({
        canonicalPlayerId: verifiedId,
        canonicalExternalProviderPlayerId: "981102",
        externalProvider: "api-football",
        externalProviderPlayerId: "981002",
      });
    const fixture = {
      ...catalog("816")[0],
      players: ["981001", "981002", "981003", "981004"].map(
        (externalPlayerId, index) => ({
          ...catalog("816")[0].players[index],
          externalPlayerId,
          name: [
            "Stored Photo",
            "Verified Player",
            "No Photo",
            "Conflicting Photo",
          ][index],
        }),
      ),
      coach: {
        status: "unavailable" as const,
        reason: "coach-missing" as const,
      },
    };
    const squad = [
      {
        externalPlayerId: "981001",
        name: "Stored Photo",
        photoUrl: "https://media.api-sports.io/football/players/999.png",
      },
      {
        externalPlayerId: "981002",
        name: "Verified Player",
        photoUrl: verifiedPhoto,
      },
      {
        externalPlayerId: "981003",
        name: "No Photo",
        photoUrl: "https://example.com/invalid.png",
      },
      {
        externalPlayerId: "981004",
        name: "Conflicting Photo",
        photoUrl: "https://media.api-sports.io/football/players/400.png",
      },
      {
        externalPlayerId: "981004",
        name: "Conflicting Photo",
        photoUrl: "https://media.api-sports.io/football/players/401.png",
      },
      {
        externalPlayerId: "981999",
        name: "Squad Only",
        photoUrl: "https://media.api-sports.io/football/players/981999.png",
      },
    ];
    const service = new AdminCatalogImportService(database);
    const { action, plan } = await service.preview(
      teamId,
      owner,
      provider([fixture], squad),
    );
    expect(plan).toMatchObject({
      photoFills: 1,
      photoGaps: 2,
      providerRequests: 4,
    });
    expect(
      plan.players.map(({ name, photoStatus }) => [name, photoStatus]),
    ).toEqual(
      expect.arrayContaining([
        ["Stored Photo", "preserved"],
        ["Verified Player", "fill"],
        ["No Photo", "missing"],
        ["Conflicting Photo", "conflict"],
      ]),
    );
    expect(
      action.players.find((player) => player.id === verifiedId),
    ).toMatchObject({
      canonicalExternalId: "981102",
      photoUrl: verifiedPhoto,
    });
    expect(
      action.players.find(
        (player) =>
          player.id === providerEntityId("player", "api-football", "981004"),
      ),
    ).toMatchObject({
      photoConflict: true,
    });
    const token = await authorize(action, owner);
    await service.applyAuthorized(action, owner, token);
    expect(
      (await database.doc(`players/${storedId}`).get()).data(),
    ).toMatchObject({
      identityProvenance: "operator_verified",
      photoUrl: existingPhoto,
    });
    expect(
      (await database.doc(`players/${verifiedId}`).get()).data(),
    ).toMatchObject({
      displayName: "Verified Player",
      identityProvenance: "operator_verified",
      position: "defender",
      currentTeamId: "other-club",
      photoUrl: verifiedPhoto,
    });
    for (const externalId of ["981003", "981004"]) {
      expect(
        (
          await database
            .doc(
              `players/${providerEntityId("player", "api-football", externalId)}`,
            )
            .get()
        ).data()?.photoUrl,
      ).toBeUndefined();
    }
    expect(
      (
        await database
          .doc(
            `players/${providerEntityId("player", "api-football", "981999")}`,
          )
          .get()
      ).exists,
    ).toBe(false);
    const repeated = await service.preview(
      teamId,
      `${owner}-again`,
      provider([fixture], squad),
    );
    expect(repeated.plan).toMatchObject({
      photoFills: 0,
      photoGaps: 2,
      proposedWrites: 2,
    });
  });

  it("rejects a photo added after preview without consuming the challenge", async () => {
    const teamId = `team-catalog-photo-stale-${++serial}`;
    const owner = `owner-photo-stale-${serial}`;
    const externalId = "982001";
    const playerId = providerEntityId("player", "api-football", externalId);
    await seed(teamId, "816");
    await database.doc(`players/${playerId}`).set({
      displayName: "Stale Photo",
      identityProvenance: "operator_verified",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    const fixture = {
      ...catalog("816")[0],
      players: [
        {
          ...catalog("816")[0].players[0],
          externalPlayerId: externalId,
          name: "Stale Photo",
        },
      ],
      coach: {
        status: "unavailable" as const,
        reason: "coach-missing" as const,
      },
    };
    const service = new AdminCatalogImportService(database);
    const { action } = await service.preview(
      teamId,
      owner,
      provider(
        [fixture],
        [
          {
            externalPlayerId: externalId,
            name: "Stale Photo",
            photoUrl: "https://media.api-sports.io/football/players/982001.png",
          },
        ],
      ),
    );
    expect(action.players[0].photoUrl).toBeDefined();
    const token = await authorize(action, owner);
    const newerPhoto =
      "https://media.api-sports.io/football/players/982002.png";
    await database.doc(`players/${playerId}`).update({ photoUrl: newerPhoto });
    await expect(
      service.applyAuthorized(action, owner, token),
    ).rejects.toMatchObject({ code: "stale" });
    expect(
      (await database.doc(`players/${playerId}`).get()).data()?.photoUrl,
    ).toBe(newerPhoto);
    expect(
      (
        await database
          .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
          .get()
      ).data()?.consumedAt,
    ).toBeUndefined();
    expect(
      (
        await database
          .doc(`adminAudit/catalog-import-${adminChallengeDocumentId(token)}`)
          .get()
      ).exists,
    ).toBe(false);
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
