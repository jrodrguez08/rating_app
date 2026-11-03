import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { trackedMatchId } from "@/application/match-identity";
import {
  coachWithSearchIndex,
  COACH_SEARCH_INDEX_VERSION,
} from "@/application/coach-search";

const projectId = "demo-rating-app-e2e";
const ownerUid = "e2e-owner";
const fixtureId = "e2e-shared-fixture";
const publishedFixtureId = "e2e-published-fixture";
const preparationFixtureId = "e2e-preparation-fixture";
const clubs = [
  {
    slug: "herediano",
    teamId: "club-sport-herediano",
    providerId: "815",
    name: "Club Sport Herediano",
    shortName: "Herediano",
  },
  {
    slug: "saprissa",
    teamId: "deportivo-saprissa",
    providerId: "816",
    name: "Deportivo Saprissa",
    shortName: "Saprissa",
  },
] as const;

export const e2eMatches = Object.fromEntries(
  clubs.map((club) => [
    club.slug,
    {
      open: trackedMatchId("api-football", fixtureId, club.teamId),
      published: trackedMatchId(
        "api-football",
        publishedFixtureId,
        club.teamId,
      ),
      preparation: trackedMatchId(
        "api-football",
        preparationFixtureId,
        club.teamId,
      ),
    },
  ]),
) as Record<
  (typeof clubs)[number]["slug"],
  { open: string; published: string; preparation: string }
>;

export default async function seed(): Promise<void> {
  if (
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
    process.env.GCLOUD_PROJECT !== projectId
  ) {
    throw new Error("E2E seeding requires the dedicated local demo emulators.");
  }
  const app = initializeApp({ projectId }, "e2e-seed");
  const database = getFirestore(app);
  const auth = getAuth(app);
  const now = new Date();
  const stamp = Timestamp.fromDate(now);
  try {
    await auth.createUser({
      uid: ownerUid,
      email: "owner@e2e.test",
      password: "E2e-owner-password-2026!",
      emailVerified: true,
    });
    await database.doc("coachSearchIndex/state").set({
      status: "complete",
      schemaVersion: COACH_SEARCH_INDEX_VERSION,
      blockingIssueCount: 0,
      auditedAt: stamp,
    });
    for (const club of clubs) {
      const coachId = `e2e-${club.slug}-coach`;
      await database.doc(`coaches/${coachId}`).set(
        coachWithSearchIndex({
          id: coachId,
          displayName: `${club.shortName} Entrenador`,
          associatedTeamIds: [club.teamId],
          identityProvenance: "operator_verified",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }),
      );
      await database.doc(`teams/${club.teamId}`).set({
        displayName: club.name,
        shortName: club.shortName,
        countryName: "Costa Rica",
        countryCode: "CR",
        brandingKey: club.slug,
        externalProviderId: club.providerId,
        createdAt: stamp,
        updatedAt: stamp,
      });
      await database
        .doc(`teams/${club.teamId}/playerMembershipIndex/state`)
        .set({
          teamId: club.teamId,
          status: "complete",
          schemaVersion: 1,
          baselineMembershipCount: 16,
          blockingIssueCount: 0,
          auditedAt: stamp,
        });
      await database.doc(`standings/${club.teamId}`).set({
        trackedTeamId: club.teamId,
        competitionId: "e2e-competition",
        competitionName: "Liga E2E",
        seasonId: "e2e-season",
        seasonName: "2026",
        externalProvider: "api-football",
        externalProviderCompetitionId: "162",
        externalProviderSeason: 2026,
        rows: clubs.map((entry, index) => ({
          rank: index + 1,
          externalTeamId: entry.providerId,
          teamName: entry.shortName,
          played: 1,
          won: index === 0 ? 1 : 0,
          drawn: 0,
          lost: index === 0 ? 0 : 1,
          goalsFor: index === 0 ? 2 : 1,
          goalsAgainst: index === 0 ? 1 : 2,
          goalDifference: index === 0 ? 1 : -1,
          points: index === 0 ? 3 : 0,
        })),
        providerSyncedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      });
      const playerResults: Record<
        string,
        {
          playerId: string;
          playerName: string;
          average: number;
          voteCount: number;
          order: number;
        }
      > = {};
      for (let index = 0; index < 16; index += 1) {
        const playerId = `e2e-${club.slug}-player-${index + 1}`;
        const name =
          index === 0
            ? `${club.shortName} Nombre extraordinariamente largo`
            : `${club.shortName} Jugador ${index + 1}`;
        await database.doc(`players/${playerId}`).set({
          displayName: name,
          currentTeamId: club.teamId,
          createdAt: stamp,
          updatedAt: stamp,
        });
        await database
          .doc(`teams/${club.teamId}/playerMemberships/${playerId}`)
          .set({
            playerId,
            teamId: club.teamId,
            displayName: name,
            searchName: name.toLowerCase(),
            searchPrefixes: [club.shortName.toLowerCase()],
            source: "match_participant",
            sourceMatchId: e2eMatches[club.slug].open,
            firstObservedAt: stamp,
            lastObservedAt: stamp,
            createdAt: stamp,
            updatedAt: stamp,
          });
        playerResults[playerId] = {
          playerId,
          playerName: name,
          average: index === 0 ? (club.slug === "herediano" ? 9 : 8) : 7,
          voteCount: 1,
          order: index,
        };
      }
      for (const [state, matchId] of Object.entries(e2eMatches[club.slug]) as [
        "open" | "published" | "preparation",
        string,
      ][]) {
        const published = state === "published";
        const preparation = state === "preparation";
        const kickoff = new Date(
          now.getTime() - (published ? 86_400_000 : 3_600_000),
        );
        const homeTeam = { externalProviderId: "815", name: "Herediano" };
        const awayTeam = { externalProviderId: "816", name: "Saprissa" };
        await database.doc(`matches/${matchId}`).set({
          trackedTeamId: club.teamId,
          trackedTeamExternalProviderId: club.providerId,
          competitionId: "e2e-competition",
          seasonId: "e2e-season",
          homeTeam,
          awayTeam,
          kickoffAt: Timestamp.fromDate(kickoff),
          status: "finished",
          ratingState: published
            ? "rating_closed"
            : preparation
              ? "preparing_rating"
              : "rating_ready",
          score: { home: 2, away: 1 },
          votingOpensAt: Timestamp.fromDate(
            new Date(now.getTime() - (published ? 80_000_000 : 1_800_000)),
          ),
          votingClosesAt: Timestamp.fromDate(
            new Date(now.getTime() + (published ? -72_000_000 : 7_200_000)),
          ),
          externalProvider: "api-football",
          externalProviderFixtureId: published
            ? publishedFixtureId
            : preparation
              ? preparationFixtureId
              : fixtureId,
          createdAt: stamp,
          updatedAt: stamp,
        });
        for (let index = 0; index < 16; index += 1) {
          const playerId = `e2e-${club.slug}-player-${index + 1}`;
          await database
            .doc(`matches/${matchId}/participants/${playerId}`)
            .set({
              matchId,
              playerId,
              teamId: club.teamId,
              externalProviderTeamId: club.providerId,
              playerName: playerResults[playerId].playerName,
              squadRole: index < 11 ? "starter" : "substitute",
              starter: index < 11,
              participated: true,
              participationStatus:
                index < 11 ? "confirmed_starter" : "confirmed_substitute",
              ...(index >= 11 ? { enteredAtMinute: 60 + index - 11 } : {}),
              createdAt: stamp,
              updatedAt: stamp,
            });
        }
        await database
          .doc(`matches/${matchId}/coachAssignments/head-coach`)
          .set({
            matchId,
            coachId: `e2e-${club.slug}-coach`,
            teamId: club.teamId,
            externalProviderTeamId: club.providerId,
            role: "head-coach",
            coachName: `${club.shortName} Entrenador`,
            createdAt: stamp,
            updatedAt: stamp,
          });
        if (published) {
          const mvpId = `e2e-${club.slug}-player-1`;
          await database.doc(`matches/${matchId}/results/summary`).set({
            matchId,
            teamId: club.teamId,
            ballotCount: 1,
            status: "final",
            playerResults,
            coachResult: {
              coachId: `e2e-${club.slug}-coach`,
              coachName: `${club.shortName} Entrenador`,
              average: 8,
              voteCount: 1,
            },
            mvpPlayerIds: [mvpId],
            generatedAt: stamp,
          });
        }
      }
    }
    await database
      .doc("competitions/e2e-competition")
      .set({ name: "Partido sintético E2E" });
  } finally {
    await deleteApp(app);
  }
}
