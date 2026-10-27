import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildStudioMatchPresentation } from "@/application/studio";
import { initialClub } from "@/config/club";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import { AdminResultService, AdminStudioService } from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `studio-tests-${Date.now()}`);
const database = getFirestore(app);
const catalog = new AdminStudioService(database);
const results = new AdminResultService(database);
const generatedAt = new Date("2026-10-20T05:00:00.000Z");
const providerPlayerId = providerEntityId("player", "api-football", "44");

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  await seed("studio-published", "rating_closed", providerPlayerId);
  await seed("studio-reopened", "rating_ready", "other-player");
  const timestamp = Timestamp.fromDate(generatedAt);
  await database.doc(`players/${providerPlayerId}`).set({
    displayName: "Nombre anterior",
    externalProvider: "api-football",
    externalProviderId: "44",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc("players/canonical-player").set({
    displayName: "Nombre canónico",
    photoUrl: "https://media.api-sports.io/football/players/44.png",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database
    .doc(`playerProviderAliases/${playerProviderAliasId("api-football", "44")}`)
    .set({
      canonicalPlayerId: "canonical-player",
      canonicalExternalProviderPlayerId: "44",
      externalProvider: "api-football",
      externalProviderPlayerId: "44",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
});

afterAll(() => deleteApp(app));

describe("public Studio persistence path", () => {
  it("lists only current published results newest-first and performs no writes", async () => {
    const before = await database.doc("matches/studio-published").get();
    const matches = await catalog.listPublishedMatches(initialClub.teamId);
    const page = await results.getPublishedPageState("studio-published");
    const after = await database.doc("matches/studio-published").get();

    expect(matches.map(({ matchId }) => matchId)).toContain("studio-published");
    expect(matches.map(({ matchId }) => matchId)).not.toContain(
      "studio-reopened",
    );
    expect(page).toMatchObject({
      state: "ready",
      podium: {
        players: [
          {
            playerId: "canonical-player",
            displayName: "Nombre canónico",
            photoUrl: "https://media.api-sports.io/football/players/44.png",
          },
        ],
      },
    });
    if (page.state !== "ready") throw new Error("Expected a published result.");
    expect(
      buildStudioMatchPresentation(page.match, page.result, page.podium),
    ).toMatchObject({ playerAverage: 8.5 });
    expect(after.data()).toEqual(before.data());
  });
});

async function seed(
  matchId: string,
  ratingState: "rating_closed" | "rating_ready",
  playerId: string,
) {
  const timestamp = Timestamp.fromDate(generatedAt);
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: initialClub.teamId,
    competitionId: "competition-1",
    seasonId: "season-1",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "819", name: "Pérez Zeledón" },
    kickoffAt: Timestamp.fromDate(new Date("2026-10-20T02:00:00.000Z")),
    status: "finished",
    ratingState,
    score: { home: 2, away: 1 },
    externalProvider: "api-football",
    externalProviderFixtureId: matchId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc(`matches/${matchId}/results/summary`).set({
    matchId,
    teamId: initialClub.teamId,
    ballotCount: 2,
    status: "final",
    playerResults: {
      [playerId]: {
        playerId,
        playerName: "Nombre anterior",
        average: 8.5,
        voteCount: 2,
        order: 0,
      },
    },
    coachResult: {
      coachId: "coach-1",
      coachName: "Jafet Soto",
      average: 7.5,
      voteCount: 2,
    },
    mvpPlayerIds: [playerId],
    generatedAt: timestamp,
  });
}
