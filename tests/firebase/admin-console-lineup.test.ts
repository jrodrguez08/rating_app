import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initialClub } from "@/config/club";
import { playerProviderAliasId } from "@/domain/player-identity";
import {
  normalizePlayerSearch,
  playerSearchPrefixes,
} from "@/domain/player-search";
import { AdminConsoleService } from "@/lib/firebase/admin-console";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `admin-console-lineup-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminConsoleService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("admin console lineup reads", () => {
  it("preloads persisted provider starters and bench without confirming entry", async () => {
    const matchId = `admin-provider-${Date.now()}`;
    await seedMatch(matchId);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        seedPlayerAndParticipant(matchId, index + 1),
      ),
    );

    const detail = await service.detail(matchId);

    expect(detail?.participants).toHaveLength(12);
    expect(
      detail?.participants.filter(
        ({ participationStatus }) =>
          participationStatus === "confirmed_starter",
      ),
    ).toHaveLength(11);
    expect(
      detail?.participants.find(
        ({ playerId }) => playerId === `${matchId}-player-12`,
      ),
    ).toMatchObject({
      playerId: `${matchId}-player-12`,
      participationStatus: "unused_substitute",
      participated: false,
      participationProvenance: "provider",
    });
  });

  it("prefers the fixture verified snapshot over incomplete materialized data", async () => {
    const matchId = `admin-verified-${Date.now()}`;
    await seedMatch(matchId);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        seedPlayerAndParticipant(matchId, index + 1),
      ),
    );
    const now = Timestamp.now();
    await database.doc(`matches/${matchId}/verifiedLineups/current`).set({
      matchId,
      trackedTeamId: initialClub.teamId,
      externalProvider: "api-football",
      externalFixtureId: `${matchId}-fixture`,
      participants: Array.from({ length: 12 }, (_, index) => ({
        playerId: `${matchId}-player-${index + 1}`,
        playerName: `Jugador ${index + 1}`,
        squadRole: index < 11 ? "starter" : "substitute",
        participationStatus:
          index < 11 ? "confirmed_starter" : "confirmed_substitute",
        participated: true,
        identityProvenance: "provider",
        externalProviderPlayerId: `${matchId}-provider-${index + 1}`,
        ...(index === 11 ? { enteredAtMinute: 70 } : {}),
        verificationSource: "https://evidence.example/match",
        verificationReason: "Verified against the fixture report.",
        verifiedBy: "owner-uid",
        verifiedAt: now,
      })),
      operatorId: "owner-uid",
      verificationSource: "https://evidence.example/match",
      verificationReason: "Verified against the fixture report.",
      provenance: "operator_verified",
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const detail = await service.detail(matchId);

    expect(detail?.participants.at(-1)).toMatchObject({
      participationStatus: "confirmed_substitute",
      participated: true,
      enteredAtMinute: 70,
      participationProvenance: "operator_verified",
      verificationSource: "https://evidence.example/match",
    });
  });

  it("searches only the bounded configured-Team canonical roster", async () => {
    const suffix = Date.now();
    await Promise.all([
      database.doc(`players/search-team-${suffix}`).set({
        displayName: "Álvaro Canónico",
        currentTeamId: initialClub.teamId,
        identityProvenance: "provider",
        position: "defender",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      database.doc(`players/search-other-${suffix}`).set({
        displayName: "Álvaro Rival",
        currentTeamId: "other-team",
        identityProvenance: "provider",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
      database
        .doc(
          `teams/${initialClub.teamId}/playerMemberships/search-team-${suffix}`,
        )
        .set(membership(`search-team-${suffix}`, "Álvaro Canónico")),
    ]);

    const results = await service.searchPlayers("alvaro");

    expect(results).toContainEqual(
      expect.objectContaining({
        id: `search-team-${suffix}`,
        name: "Álvaro Canónico",
      }),
    );
    expect(results.map(({ id }) => id)).not.toContain(`search-other-${suffix}`);
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("resolves a searched legacy provider identity to one canonical Player", async () => {
    const suffix = Date.now();
    const canonicalId = `search-canonical-${suffix}`;
    const legacyId = `search-legacy-${suffix}`;
    const now = Timestamp.now();
    await Promise.all([
      database.doc(`players/${canonicalId}`).set({
        displayName: "Nombre Canónico",
        currentTeamId: initialClub.teamId,
        externalProvider: "api-football",
        externalProviderId: `canonical-${suffix}`,
        identityProvenance: "provider",
        createdAt: now,
        updatedAt: now,
      }),
      database.doc(`players/${legacyId}`).set({
        displayName: "Nombre Histórico",
        currentTeamId: initialClub.teamId,
        externalProvider: "api-football",
        externalProviderId: `legacy-${suffix}`,
        identityProvenance: "provider",
        createdAt: now,
        updatedAt: now,
      }),
      database
        .doc(`teams/${initialClub.teamId}/playerMemberships/${legacyId}`)
        .set(membership(legacyId, "Nombre Histórico")),
      database
        .doc(
          `playerProviderAliases/${playerProviderAliasId(
            "api-football",
            `legacy-${suffix}`,
          )}`,
        )
        .set({
          canonicalPlayerId: canonicalId,
          canonicalExternalProviderPlayerId: `canonical-${suffix}`,
          externalProvider: "api-football",
          externalProviderPlayerId: `legacy-${suffix}`,
          createdAt: now,
          updatedAt: now,
        }),
    ]);

    const results = await service.searchPlayers("Histórico");

    expect(results).toEqual([
      expect.objectContaining({ id: canonicalId, name: "Nombre Canónico" }),
    ]);
  });

  it("finds historical and transferred Players beyond 150 records without opponent leakage", async () => {
    const suffix = Date.now();
    const targetId = `historical-target-${suffix}`;
    const batch = database.batch();
    for (let index = 0; index < 170; index += 1) {
      const playerId = `historical-${suffix}-${index}`;
      const displayName = `Histórico ${index}`;
      batch.set(database.doc(`players/${playerId}`), {
        displayName,
        currentTeamId: index === 169 ? "transferred-team" : initialClub.teamId,
        identityProvenance: "provider",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      batch.set(
        database.doc(
          `teams/${initialClub.teamId}/playerMemberships/${playerId}`,
        ),
        membership(playerId, displayName),
      );
    }
    batch.set(database.doc(`players/${targetId}`), {
      displayName: "Óscar Transferido Único",
      currentTeamId: "transferred-team",
      identityProvenance: "provider",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    batch.set(
      database.doc(`teams/${initialClub.teamId}/playerMemberships/${targetId}`),
      membership(targetId, "Óscar Transferido Único"),
    );
    await batch.commit();

    const results = await service.searchPlayers("oscar transf");

    expect(results).toEqual([
      expect.objectContaining({
        id: targetId,
        name: "Óscar Transferido Único",
      }),
    ]);
    expect(results.length).toBeLessThanOrEqual(20);
  });
});

function membership(playerId: string, displayName: string) {
  const now = Timestamp.now();
  return {
    playerId,
    teamId: initialClub.teamId,
    displayName,
    searchName: normalizePlayerSearch(displayName),
    searchPrefixes: playerSearchPrefixes(displayName),
    source: "match_participant",
    sourceMatchId: "historical-fixture",
    firstObservedAt: now,
    lastObservedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedMatch(matchId: string) {
  const now = Timestamp.now();
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: initialClub.teamId,
    trackedTeamExternalProviderId: "815",
    externalProvider: "api-football",
    externalProviderFixtureId: `${matchId}-fixture`,
    kickoffAt: now,
    homeTeam: { id: initialClub.teamId, name: "Herediano" },
    awayTeam: { id: "opponent", name: "Rival" },
    status: "finished",
    ratingState: "preparing_rating",
    lineupSnapshotAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedPlayerAndParticipant(matchId: string, number: number) {
  const now = Timestamp.now();
  const playerId = `${matchId}-player-${number}`;
  const starter = number <= 11;
  await Promise.all([
    database.doc(`players/${playerId}`).set({
      displayName: `Jugador ${number}`,
      currentTeamId: initialClub.teamId,
      externalProvider: "api-football",
      externalProviderId: `${matchId}-provider-${number}`,
      identityProvenance: "provider",
      position: starter ? "midfielder" : "attacker",
      createdAt: now,
      updatedAt: now,
    }),
    database.doc(`matches/${matchId}/participants/${playerId}`).set({
      matchId,
      playerId,
      teamId: initialClub.teamId,
      externalProvider: "api-football",
      externalProviderTeamId: "815",
      externalProviderPlayerId: `${matchId}-provider-${number}`,
      playerName: `Jugador ${number}`,
      shirtNumber: number,
      squadRole: starter ? "starter" : "substitute",
      starter,
      participated: starter,
      participationStatus: starter ? "confirmed_starter" : "unused_substitute",
      identityProvenance: "provider",
      participationProvenance: "provider",
      createdAt: now,
      updatedAt: now,
    }),
  ]);
}
