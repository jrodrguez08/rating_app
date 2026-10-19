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

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
  await database
    .doc(`teams/${initialClub.teamId}/playerMembershipIndex/state`)
    .set({
      teamId: initialClub.teamId,
      status: "complete",
      schemaVersion: 1,
      baselineMembershipCount: 0,
      blockingIssueCount: 0,
      auditedAt: Timestamp.now(),
    });
});

afterAll(() => deleteApp(app));

describe("admin console lineup reads", () => {
  it("suppresses stale diagnostics after manual opening and classifies the trusted window", async () => {
    const matchId = "admin-view-match-10a50b08075ca1f0646e5b6d";
    const now = new Date("2026-10-19T20:30:00.000Z");
    await seedMatch(matchId);
    await database.doc(`matches/${matchId}`).update({
      ratingState: "rating_ready",
      ratingBlockReason: "unknown",
      ratingBlockObservedAt: Timestamp.fromDate(
        new Date("2026-10-19T19:00:00.000Z"),
      ),
      votingOpeningMode: "manual",
      votingOpensAt: Timestamp.fromDate(new Date("2026-10-19T20:00:00.000Z")),
      votingClosesAt: Timestamp.fromDate(new Date("2026-10-19T22:00:00.000Z")),
    });
    const readService = new AdminConsoleService(database, undefined, () => now);
    const persistedBefore = (
      await database.doc(`matches/${matchId}`).get()
    ).data();

    const detail = await readService.detail(matchId);
    const overview = await readService.overview();

    expect(detail?.match).toMatchObject({
      externalFixtureId: `${matchId}-fixture`,
      ratingState: "rating_ready",
      votingPresentation: "open",
      effectiveVotingOpensAt: "2026-10-19T20:00:00.000Z",
      effectiveVotingClosesAt: "2026-10-19T22:00:00.000Z",
      votingRemainingMinutes: 90,
    });
    expect(detail?.match.diagnostic).toBeUndefined();
    expect(detail?.match.unrecognizedDiagnostic).toBeUndefined();
    expect(detail?.manualVotingAvailability).toEqual({ state: "voting_open" });
    expect(
      overview.votingCompletedMatches.find(({ id }) => id === matchId),
    ).toMatchObject({ votingPresentation: "open" });
    expect(overview.upcomingLiveMatches.some(({ id }) => id === matchId)).toBe(
      false,
    );
    expect(overview.attentionMatches.some(({ id }) => id === matchId)).toBe(
      false,
    );
    expect((await database.doc(`matches/${matchId}`).get()).data()).toEqual(
      persistedBefore,
    );
  });

  it("distinguishes expired windows, published results, and current diagnostics", async () => {
    const now = new Date("2026-10-19T23:00:00.000Z");
    const expiredId = `admin-expired-${Date.now()}`;
    const publishedId = `admin-published-${Date.now()}`;
    const blockedId = `admin-blocked-${Date.now()}`;
    await Promise.all([
      seedMatch(expiredId),
      seedMatch(publishedId),
      seedMatch(blockedId),
    ]);
    await Promise.all([
      database.doc(`matches/${expiredId}`).update({
        ratingState: "rating_ready",
        ratingBlockReason: "missing_participant_evidence",
        votingOpensAt: Timestamp.fromDate(new Date("2026-10-19T20:00:00.000Z")),
        votingClosesAt: Timestamp.fromDate(
          new Date("2026-10-19T22:00:00.000Z"),
        ),
      }),
      database.doc(`matches/${publishedId}`).update({
        ratingState: "rating_closed",
        ratingBlockReason: "missing_coach_evidence",
      }),
      database.doc(`matches/${blockedId}`).update({
        ratingBlockReason: "provider_failure",
      }),
    ]);
    const readService = new AdminConsoleService(database, undefined, () => now);

    const [expired, published, blocked] = await Promise.all([
      readService.detail(expiredId),
      readService.detail(publishedId),
      readService.detail(blockedId),
    ]);

    expect(expired?.match).toMatchObject({ votingPresentation: "expired" });
    expect(expired?.match.diagnostic).toBeUndefined();
    expect(expired?.manualVotingAvailability).toEqual({
      state: "voting_expired",
    });
    expect(published?.match).toMatchObject({
      votingPresentation: "published",
    });
    expect(published?.match.diagnostic).toBeUndefined();
    expect(published?.manualVotingAvailability).toEqual({
      state: "results_published",
    });
    expect(blocked?.match).toMatchObject({
      votingPresentation: "preparation",
      diagnostic: "provider_failure",
    });
  });

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

    const { players: results } = await service.searchPlayers("alvaro");

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

    const { players: results } = await service.searchPlayers("Histórico");

    expect(results).toContainEqual(
      expect.objectContaining({ id: canonicalId, name: "Nombre Canónico" }),
    );
    expect(results.filter(({ id }) => id === canonicalId)).toHaveLength(1);
    expect(results.some(({ id }) => id === legacyId)).toBe(false);
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

    const { players: results } = await service.searchPlayers("oscar transf");

    expect(results).toEqual([
      expect.objectContaining({
        id: targetId,
        name: "Óscar Transferido Único",
      }),
    ]);
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("makes every matching membership reachable across bounded pages", async () => {
    const suffix = Date.now();
    const batch = database.batch();
    for (let index = 0; index < 55; index += 1) {
      const playerId = `paged-${suffix}-${String(index).padStart(2, "0")}`;
      const displayName = `Paginado Único ${index}`;
      batch.set(database.doc(`players/${playerId}`), {
        displayName,
        currentTeamId: initialClub.teamId,
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
    await batch.commit();

    const players = [];
    let cursor: string | undefined;
    do {
      const page = await service.searchPlayers("paginado unico", cursor);
      players.push(...page.players);
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(players.map(({ id }) => id)).size).toBe(55);
    expect(players).toHaveLength(55);
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
