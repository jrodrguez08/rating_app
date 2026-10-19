import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initialClub } from "@/config/club";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import { AdminConsoleService } from "@/lib/firebase/admin-console";
import { AdminPlayerHistoryService } from "@/lib/firebase/server";
import { runMembershipBackfill } from "../../scripts/backfill-team-player-memberships";

const projectId = `demo-rating-parity-${process.pid}`;
const app = initializeApp({ projectId }, `player-parity-${Date.now()}`);
const database = getFirestore(app);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("public and administrative Player discovery parity", () => {
  it("finds canonical historical Players beyond prior match and participant caps", async () => {
    const suffix = Date.now();
    const legacyExternalId = `parity-legacy-${suffix}`;
    const canonicalExternalId = `parity-canonical-${suffix}`;
    const legacyId = `persisted-legacy-${suffix}`;
    const canonicalId = providerEntityId(
      "player",
      "api-football",
      canonicalExternalId,
    );
    const opponentId = `parity-opponent-${suffix}`;
    const internalId = `parity-internal-${suffix}`;
    const oldMatchId = `parity-${suffix}-000`;
    const oldKickoff = Timestamp.fromDate(new Date("2020-01-01T00:00:00.000Z"));
    const now = Timestamp.fromDate(new Date("2026-10-01T00:00:00.000Z"));

    const writes: Array<{ path: string; value: Record<string, unknown> }> = [
      {
        path: `teams/${initialClub.teamId}`,
        value: {
          displayName: "Club Sport Herediano",
          shortName: "Herediano",
          countryName: "Costa Rica",
          countryCode: "CR",
          brandingKey: "herediano",
          externalProviderId: "815",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        path: `players/${canonicalId}`,
        value: {
          displayName: `Transferido Paridad ${suffix}`,
          currentTeamId: "transferred-team",
          externalProvider: "api-football",
          externalProviderId: canonicalExternalId,
          identityProvenance: "provider",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        path: `players/${legacyId}`,
        value: {
          displayName: `Nombre Histórico ${suffix}`,
          externalProvider: "api-football",
          externalProviderId: legacyExternalId,
          identityProvenance: "provider",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        path: `players/${opponentId}`,
        value: {
          displayName: `Rival Exclusivo ${suffix}`,
          currentTeamId: "opponent-team",
          identityProvenance: "provider",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        path: `players/${internalId}`,
        value: {
          displayName: `Interno Verificado ${suffix}`,
          identityProvenance: "operator_verified",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        path: `playerProviderAliases/${playerProviderAliasId(
          "api-football",
          legacyExternalId,
        )}`,
        value: {
          canonicalPlayerId: canonicalId,
          canonicalExternalProviderPlayerId: canonicalExternalId,
          externalProvider: "api-football",
          externalProviderPlayerId: legacyExternalId,
          createdAt: now,
          updatedAt: now,
        },
      },
    ];
    for (let index = 0; index < 101; index += 1) {
      const matchId = `parity-${suffix}-${String(index).padStart(3, "0")}`;
      writes.push({
        path: `matches/${matchId}`,
        value: match(
          matchId,
          index === 0 ? oldKickoff : now,
          `fixture-${suffix}-${index}`,
          index === 0 ? "rating_closed" : "not_ready",
        ),
      });
    }
    for (let index = 0; index < 500; index += 1) {
      const playerId = `parity-filler-${suffix}-${String(index).padStart(3, "0")}`;
      writes.push({
        path: `players/${playerId}`,
        value: {
          displayName: `Histórico Paridad ${index}`,
          identityProvenance: "provider",
          createdAt: now,
          updatedAt: now,
        },
      });
      writes.push({
        path: `matches/${oldMatchId}/participants/${playerId}`,
        value: participant(oldMatchId, playerId, initialClub.teamId, now),
      });
    }
    writes.push(
      {
        path: `matches/${oldMatchId}/participants/${legacyId}`,
        value: {
          ...participant(oldMatchId, legacyId, initialClub.teamId, now),
          playerName: `Nombre Histórico ${suffix}`,
          externalProvider: "api-football",
          externalProviderPlayerId: legacyExternalId,
        },
      },
      {
        path: `matches/${oldMatchId}/participants/${opponentId}`,
        value: participant(oldMatchId, opponentId, "opponent-team", now),
      },
      {
        path: `matches/${oldMatchId}/verifiedLineups/current`,
        value: {
          matchId: oldMatchId,
          trackedTeamId: initialClub.teamId,
          externalProvider: "api-football",
          externalFixtureId: `fixture-${suffix}-0`,
          participants: [
            {
              playerId: internalId,
              playerName: `Interno Verificado ${suffix}`,
              squadRole: "starter",
              participationStatus: "confirmed_starter",
              participated: true,
              identityProvenance: "operator_verified",
              verificationSource: "https://evidence.example/parity",
              verificationReason: "Independent fixture evidence.",
              verifiedBy: "owner-uid",
              verifiedAt: "2026-10-01T00:00:00.000Z",
            },
          ],
          operatorId: "owner-uid",
          verificationSource: "https://evidence.example/parity",
          verificationReason: "Independent fixture evidence.",
          provenance: "operator_verified",
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        path: `matches/${oldMatchId}/results/summary`,
        value: {
          matchId: oldMatchId,
          teamId: initialClub.teamId,
          ballotCount: 2,
          playerResults: {
            [legacyId]: {
              playerId: legacyId,
              playerName: `Nombre Histórico ${suffix}`,
              average: 8,
              voteCount: 2,
              order: 0,
            },
          },
          coachResult: {
            coachId: "coach",
            coachName: "Coach",
            average: 7,
            voteCount: 2,
          },
          mvpPlayerIds: [legacyId],
          status: "final",
          generatedAt: now,
        },
      },
    );
    await commitWrites(writes);

    const repaired = await runMembershipBackfill(
      database,
      initialClub.teamId,
      true,
      100,
    );
    expect(repaired.matchesScanned).toBeGreaterThan(100);
    expect(repaired.participantsScanned).toBeGreaterThan(500);
    expect(repaired.indexWrites).toBe(1);

    const publicReads: Array<{ kind: string; documents: number }> = [];
    const publicCatalog = await new AdminPlayerHistoryService(
      database,
      (read) => publicReads.push(read),
    ).list(initialClub.teamId);
    const publicPlayer = publicCatalog.players.find(
      ({ playerId }) => playerId === canonicalId,
    );
    const adminReads: Array<{ kind: string; documents: number }> = [];
    const adminService = new AdminConsoleService(database, (read) =>
      adminReads.push(read),
    );
    const adminPage = await adminService.searchPlayers(
      `nombre historico ${suffix}`,
    );
    const verifiedPage = await adminService.searchPlayers(
      `interno verificado ${suffix}`,
    );
    const opponentPage = await adminService.searchPlayers(
      `rival exclusivo ${suffix}`,
    );

    expect(publicPlayer).toMatchObject({
      playerId: canonicalId,
      ratedMatchCount: 1,
      overallAverage: 8,
    });
    expect(
      publicCatalog.players.some(({ playerId }) => playerId === legacyId),
    ).toBe(false);
    expect(adminPage.players).toEqual([
      expect.objectContaining({ id: canonicalId }),
    ]);
    expect(verifiedPage.players).toEqual([
      expect.objectContaining({ id: internalId }),
    ]);
    expect(opponentPage.players).toEqual([]);
    expect(
      adminReads
        .filter(({ kind }) => kind === "membership_query")
        .every(({ documents }) => documents <= 21),
    ).toBe(true);
    expect(adminReads.some(({ kind }) => kind === "result_query")).toBe(false);
    expect(
      adminReads
        .filter(({ kind }) => kind === "membership_query")
        .reduce((total, { documents }) => total + documents, 0),
    ).toBeLessThanOrEqual(63);
    expect(
      adminReads.reduce((total, { documents }) => total + documents, 0),
    ).toBeLessThanOrEqual(246);
    expect(publicReads.some(({ kind }) => kind === "result_query")).toBe(true);
    expect(publicReads.some(({ kind }) => kind === "membership_query")).toBe(
      true,
    );
    expect(publicCatalog.players.length).toBeGreaterThan(150);
    expect(
      await database
        .doc(`teams/${initialClub.teamId}/playerMemberships/${canonicalId}`)
        .get(),
    ).toMatchObject({ exists: true });
  }, 60_000);
});

async function commitWrites(
  writes: readonly { path: string; value: Record<string, unknown> }[],
) {
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = database.batch();
    for (const write of writes.slice(offset, offset + 400)) {
      batch.set(database.doc(write.path), write.value);
    }
    await batch.commit();
  }
}

function match(
  matchId: string,
  kickoffAt: Timestamp,
  fixtureId: string,
  ratingState: "rating_closed" | "not_ready",
) {
  return {
    trackedTeamId: initialClub.teamId,
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "2", name: `Opponent ${matchId}` },
    kickoffAt,
    status: ratingState === "rating_closed" ? "finished" : "scheduled",
    ratingState,
    score: { home: 2, away: 1 },
    externalProvider: "api-football",
    externalProviderFixtureId: fixtureId,
    createdAt: kickoffAt,
    updatedAt: kickoffAt,
  };
}

function participant(
  matchId: string,
  playerId: string,
  teamId: string,
  timestamp: Timestamp,
) {
  return {
    matchId,
    playerId,
    playerName: playerId,
    teamId,
    externalProviderTeamId: teamId,
    squadRole: "starter",
    starter: true,
    participated: true,
    participationStatus: "confirmed_starter",
    identityProvenance: "provider",
    participationProvenance: "provider",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
