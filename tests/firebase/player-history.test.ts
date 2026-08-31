import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminPlayerHistoryService } from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `player-history-${Date.now()}`);
const database = getFirestore(app);
const teamId = "player-history-team";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  const timestamp = Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z"));
  await database.doc(`teams/${teamId}`).set({
    displayName: "Tracked Team",
    shortName: "Tracked",
    countryName: "Costa Rica",
    countryCode: "CR",
    brandingKey: "tracked",
    externalProviderId: "815",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc("players/stable-player").set({
    displayName: "Current Name",
    externalProvider: "api-football",
    externalProviderId: "10",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc("players/unrated-player").set({
    displayName: "Known Unrated",
    externalProvider: "api-football",
    externalProviderId: "11",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await seedMatch("closed", "rating_closed", timestamp, "legacy-closed-id");
  await seedMatch("open", "rating_ready", timestamp);
  await database.doc("matches/closed/results/summary").set({
    matchId: "closed",
    teamId,
    ballotCount: 2,
    playerResults: {
      "stable-player": {
        playerId: "stable-player",
        playerName: "Historical Name",
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
    mvpPlayerIds: ["stable-player"],
    status: "final",
    generatedAt: timestamp,
  });
  await database.doc("matches/open/results/summary").set({
    matchId: "open",
    teamId,
    ballotCount: 1,
    playerResults: {
      "stable-player": {
        playerId: "stable-player",
        playerName: "Current Name",
        average: 10,
        voteCount: 1,
        order: 0,
      },
    },
    coachResult: {
      coachId: "coach",
      coachName: "Coach",
      average: 10,
      voteCount: 1,
    },
    mvpPlayerIds: ["stable-player"],
    status: "final",
    generatedAt: timestamp,
  });
});

afterAll(() => deleteApp(app));

describe("trusted player history reads", () => {
  it("derives public history from closed summaries without reading ballots", async () => {
    await database.doc("matches/closed/ballots/private-voter").set({
      voterId: "private-voter",
      playerRatings: { "stable-player": 8 },
    });

    const catalog = await new AdminPlayerHistoryService(database).list(teamId);
    const rated = catalog.players.find(
      ({ playerId }) => playerId === "stable-player",
    );
    const unrated = catalog.players.find(
      ({ playerId }) => playerId === "unrated-player",
    );

    expect(rated).toMatchObject({
      playerName: "Current Name",
      overallAverage: 8,
      ratedMatchCount: 1,
      rank: null,
    });
    expect(rated?.history).toHaveLength(1);
    expect(unrated).toMatchObject({ ratedMatchCount: 0, overallAverage: null });
    expect(JSON.stringify(catalog)).not.toMatch(
      /private-voter|ballot|playerRatings/,
    );
  });

  it("keeps a stable-ID player profile addressable", async () => {
    const profile = await new AdminPlayerHistoryService(database).get(
      "stable-player",
      teamId,
    );
    expect(profile?.history[0]).toMatchObject({
      matchId: "closed",
      opponentName: "Opponent closed",
    });
  });
});

async function seedMatch(
  matchId: string,
  ratingState: "rating_ready" | "rating_closed",
  timestamp: Timestamp,
  legacyPayloadId?: string,
) {
  await database.doc(`matches/${matchId}`).set({
    ...(legacyPayloadId === undefined ? {} : { id: legacyPayloadId }),
    trackedTeamId: teamId,
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Tracked Team" },
    awayTeam: { externalProviderId: "2", name: `Opponent ${matchId}` },
    kickoffAt: timestamp,
    status: "finished",
    ratingState,
    score: { home: 2, away: 1 },
    externalProvider: "api-football",
    externalProviderFixtureId: matchId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  for (const [playerId, playerName] of [
    ["stable-player", "Historical Name"],
    ["unrated-player", "Known Unrated"],
  ]) {
    await database.doc(`matches/${matchId}/participants/${playerId}`).set({
      matchId,
      playerId,
      playerName,
      teamId,
      externalProvider: "api-football",
      externalProviderTeamId: "815",
      externalProviderPlayerId: playerId,
      squadRole: "starter",
      starter: true,
      participated: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}
