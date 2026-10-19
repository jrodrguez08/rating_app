import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { playerProviderAliasId } from "@/domain/player-identity";
import {
  normalizePlayerSearch,
  playerSearchPrefixes,
} from "@/domain/player-search";
import {
  searchIndexedTeamPlayers,
  TeamPlayerMembershipIndexIncompleteError,
} from "@/lib/firebase/team-player-membership-index";
import { runMembershipBackfill } from "../../scripts/backfill-team-player-memberships";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `membership-backfill-${Date.now()}`);
const database = getFirestore(app);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("complete Team Player membership backfill", () => {
  it("marks unresolved evidence incomplete instead of publishing a partial index", async () => {
    const suffix = Date.now();
    const teamId = `incomplete-team-${suffix}`;
    const matchId = `incomplete-match-${suffix}`;
    const now = Timestamp.now();
    await database.doc(`matches/${matchId}`).set({
      trackedTeamId: teamId,
      externalProvider: "api-football",
      externalProviderFixtureId: `fixture-${suffix}`,
      kickoffAt: now,
      status: "finished",
      ratingState: "preparing_rating",
      createdAt: now,
      updatedAt: now,
    });
    await database
      .doc(`matches/${matchId}/participants/missing-player-${suffix}`)
      .set(participant(matchId, `missing-player-${suffix}`, teamId, now));

    const result = await runMembershipBackfill(database, teamId, true, 20);

    expect(result).toMatchObject({
      unresolvedIdentities: 1,
      indexStatusAfter: "incomplete",
      indexBlockingIssues: 1,
      indexWrites: 1,
    });
    await expect(
      searchIndexedTeamPlayers(database, teamId, ""),
    ).rejects.toBeInstanceOf(TeamPlayerMembershipIndexIncompleteError);
  });

  it("traverses every page and remains additive, canonical, dry-run safe, and idempotent", async () => {
    const suffix = Date.now();
    const teamId = `backfill-team-${suffix}`;
    const now = Timestamp.fromDate(new Date("2026-10-01T00:00:00.000Z"));
    const batch = database.batch();

    for (let index = 0; index < 151; index += 1) {
      const playerId = `current-${suffix}-${String(index).padStart(3, "0")}`;
      batch.set(database.doc(`players/${playerId}`), {
        displayName: `Jugador Actual ${index}`,
        currentTeamId: teamId,
        identityProvenance: "provider",
        createdAt: now,
        updatedAt: now,
      });
    }
    for (let index = 0; index < 31; index += 1) {
      const playerId = `preserved-${suffix}-${index}`;
      batch.set(database.doc(`players/${playerId}`), {
        displayName: `Preservado ${index}`,
        identityProvenance: "provider",
        createdAt: now,
        updatedAt: now,
      });
      batch.set(
        database.doc(`teams/${teamId}/playerMemberships/${playerId}`),
        membership(playerId, teamId, `Preservado ${index}`, now),
      );
    }
    for (let index = 0; index < 105; index += 1) {
      const matchId = `match-${suffix}-${String(index).padStart(3, "0")}`;
      batch.set(database.doc(`matches/${matchId}`), {
        trackedTeamId: teamId,
        externalProvider: "api-football",
        externalProviderFixtureId: `fixture-${suffix}-${index}`,
        kickoffAt: now,
        status: "finished",
        ratingState: "preparing_rating",
        votingOpensAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    const participantMatchId = `match-${suffix}-104`;
    for (let index = 0; index < 45; index += 1) {
      const playerId = `historical-${suffix}-${String(index).padStart(2, "0")}`;
      batch.set(database.doc(`players/${playerId}`), {
        displayName: `Histórico Completo ${index}`,
        ...(index === 44 ? { currentTeamId: "transferred-team" } : {}),
        identityProvenance: "provider",
        createdAt: now,
        updatedAt: now,
      });
      batch.set(
        database.doc(`matches/${participantMatchId}/participants/${playerId}`),
        participant(participantMatchId, playerId, teamId, now),
      );
    }
    const canonicalId = `canonical-${suffix}`;
    const legacyExternalId = `legacy-external-${suffix}`;
    const legacyId = `player-legacy-${suffix}`;
    batch.set(database.doc(`players/${canonicalId}`), {
      displayName: "Jugador Canónico Recuperado",
      externalProvider: "api-football",
      externalProviderId: `canonical-external-${suffix}`,
      identityProvenance: "provider",
      createdAt: now,
      updatedAt: now,
    });
    batch.set(
      database.doc(`matches/${participantMatchId}/participants/${legacyId}`),
      {
        ...participant(participantMatchId, legacyId, teamId, now),
        externalProvider: "api-football",
        externalProviderPlayerId: legacyExternalId,
      },
    );
    batch.set(
      database.doc(
        `playerProviderAliases/${playerProviderAliasId(
          "api-football",
          legacyExternalId,
        )}`,
      ),
      {
        canonicalPlayerId: canonicalId,
        canonicalExternalProviderPlayerId: `canonical-external-${suffix}`,
        externalProvider: "api-football",
        externalProviderPlayerId: legacyExternalId,
        createdAt: now,
        updatedAt: now,
      },
    );
    const opponentId = `opponent-${suffix}`;
    batch.set(database.doc(`players/${opponentId}`), {
      displayName: "Jugador Rival",
      currentTeamId: "opponent-team",
      identityProvenance: "provider",
      createdAt: now,
      updatedAt: now,
    });
    batch.set(
      database.doc(`matches/${participantMatchId}/participants/${opponentId}`),
      participant(participantMatchId, opponentId, "opponent-team", now),
    );
    const internalId = `internal-${suffix}`;
    batch.set(database.doc(`players/${internalId}`), {
      displayName: "Identidad Interna Verificada",
      identityProvenance: "operator_verified",
      createdAt: now,
      updatedAt: now,
    });
    batch.set(
      database.doc(`matches/${participantMatchId}/verifiedLineups/current`),
      {
        matchId: participantMatchId,
        trackedTeamId: teamId,
        externalProvider: "api-football",
        externalFixtureId: `fixture-${suffix}-104`,
        participants: [
          {
            playerId: internalId,
            playerName: "Identidad Interna Verificada",
            squadRole: "starter",
            participationStatus: "confirmed_starter",
            participated: true,
            identityProvenance: "operator_verified",
            verificationSource: "https://evidence.example/lineup",
            verificationReason: "Independent fixture evidence.",
            verifiedBy: "owner-uid",
            verifiedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
        operatorId: "owner-uid",
        verificationSource: "https://evidence.example/lineup",
        verificationReason: "Independent fixture evidence.",
        provenance: "operator_verified",
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    );
    await batch.commit();

    const dryRun = await runMembershipBackfill(database, teamId, false, 20);
    expect(dryRun).toMatchObject({
      matchesScanned: 105,
      participantsScanned: 47,
      existingMemberships: 31,
      writes: 0,
    });
    expect(dryRun.playersScanned).toBeGreaterThan(150);
    expect(dryRun.pages.players).toBeGreaterThan(7);
    expect(dryRun.pages.matches).toBeGreaterThan(5);
    expect(dryRun.pages.participants).toBeGreaterThan(105);
    expect(dryRun.skippedByReason.opponent_participant).toBe(1);
    expect(
      (
        await database
          .collection(`teams/${teamId}/playerMemberships`)
          .count()
          .get()
      ).data().count,
    ).toBe(31);

    const applied = await runMembershipBackfill(database, teamId, true, 20);
    expect(applied.writes).toBe(
      applied.newMemberships + applied.updatedMemberships + 1,
    );
    expect(applied).toMatchObject({
      indexStatusBefore: "missing",
      indexWritePlanned: true,
      indexWrites: 1,
    });
    expect(applied.finalUniqueMembershipCount).toBeGreaterThan(220);
    await expect(
      database.doc(`teams/${teamId}/playerMemberships/${opponentId}`).get(),
    ).resolves.toMatchObject({ exists: false });
    await expect(
      database.doc(`teams/${teamId}/playerMemberships/${canonicalId}`).get(),
    ).resolves.toMatchObject({ exists: true });
    expect(
      (
        await database
          .doc(`teams/${teamId}/playerMemberships/${internalId}`)
          .get()
      ).data()?.source,
    ).toBe("operator_verified");
    expect(
      await database
        .doc(`teams/${teamId}/playerMemberships/preserved-${suffix}-30`)
        .get(),
    ).toMatchObject({ exists: true });

    const rerun = await runMembershipBackfill(database, teamId, true, 20);
    expect(rerun.writes).toBe(0);
    expect(rerun).toMatchObject({
      indexStatusBefore: "complete",
      indexWritePlanned: false,
      indexWrites: 0,
    });
    expect(rerun.finalUniqueMembershipCount).toBe(
      applied.finalUniqueMembershipCount,
    );
    expect(
      (await database.doc(`matches/${participantMatchId}`).get()).data(),
    ).toMatchObject({
      ratingState: "preparing_rating",
      votingOpensAt: now,
    });
  });
});

function membership(
  playerId: string,
  teamId: string,
  displayName: string,
  timestamp: Timestamp,
) {
  return {
    playerId,
    teamId,
    displayName,
    searchName: normalizePlayerSearch(displayName),
    searchPrefixes: playerSearchPrefixes(displayName),
    source: "match_participant",
    sourceMatchId: "preserved-match",
    firstObservedAt: timestamp,
    lastObservedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
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
    teamId,
    externalProviderTeamId: teamId,
    playerName: playerId,
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
