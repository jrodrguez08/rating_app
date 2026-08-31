import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initialClub } from "@/config/club";
import {
  AdminMatchArchiveService,
  AdminResultService,
} from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `match-route-identity-${Date.now()}`);
const database = getFirestore(app);
const archiveService = new AdminMatchArchiveService(database);
const resultService = new AdminResultService(database);
const now = new Date("2026-08-31T12:00:00.000Z");

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  const timestamp = Timestamp.fromDate(now);
  await database.doc("competitions/competition").set({
    name: "Primera Division",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await seedMatch("featured", "2026-09-01T18:00:00.000Z", "scheduled");
  await seedMatch("upcoming", "2026-09-02T18:00:00.000Z", "scheduled");
  await seedMatch("recent", "2026-08-30T18:00:00.000Z", "finished");
  await seedMatch(
    "rated",
    "2026-08-20T18:00:00.000Z",
    "finished",
    "rating_closed",
  );
  await seedMatch(
    "other-team",
    "2026-09-03T18:00:00.000Z",
    "scheduled",
    "not_ready",
    "another-team",
  );
  await database.doc("matches/rated/results/summary").set({
    matchId: "rated",
    teamId: initialClub.teamId,
    ballotCount: 0,
    playerResults: {},
    coachResult: {
      coachId: "coach",
      coachName: "Coach",
      average: 0,
      voteCount: 0,
    },
    mvpPlayerIds: [],
    status: "no_votes",
    generatedAt: timestamp,
  });
});

afterAll(() => deleteApp(app));

describe("production-shaped match route identity", () => {
  it("resolves every configured-Team archive bucket through the detail service", async () => {
    const archive = await archiveService.list(initialClub.teamId, now);
    const ids = [
      archive.relevant?.match.id,
      ...archive.upcoming.map(({ match }) => match.id),
      ...archive.recent.map(({ match }) => match.id),
    ].filter((id): id is string => id !== undefined);

    expect(ids).toEqual(
      expect.arrayContaining(["featured", "upcoming", "recent", "rated"]),
    );
    for (const id of ids) {
      await expect(
        archiveService.get(id, initialClub.teamId),
      ).resolves.toMatchObject({
        match: { id, trackedTeamId: initialClub.teamId },
      });
    }
  });

  it("resolves normal detail and results for the same rated match ID", async () => {
    await expect(
      archiveService.get("rated", initialClub.teamId),
    ).resolves.toMatchObject({ match: { id: "rated" }, hasResults: true });
    await expect(
      resultService.getPageState("rated", now),
    ).resolves.toMatchObject({
      state: "ready",
      match: { id: "rated" },
      result: { matchId: "rated" },
    });
  });

  it("keeps unknown and cross-Team detail lookups closed", async () => {
    await expect(
      archiveService.get("missing", initialClub.teamId),
    ).resolves.toBeNull();
    await expect(
      archiveService.get("other-team", initialClub.teamId),
    ).resolves.toBeNull();
  });
});

async function seedMatch(
  matchId: string,
  kickoffAt: string,
  status: "scheduled" | "finished",
  ratingState: "not_ready" | "rating_closed" = "not_ready",
  trackedTeamId = initialClub.teamId,
) {
  const timestamp = Timestamp.fromDate(now);
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId,
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "CS Herediano" },
    awayTeam: { externalProviderId: "820", name: "Opponent" },
    kickoffAt: Timestamp.fromDate(new Date(kickoffAt)),
    status,
    ratingState,
    ...(ratingState === "rating_closed"
      ? {
          votingOpensAt: Timestamp.fromDate(
            new Date("2026-08-20T20:00:00.000Z"),
          ),
          votingClosesAt: Timestamp.fromDate(
            new Date("2026-08-20T22:00:00.000Z"),
          ),
        }
      : {}),
    score:
      status === "finished" ? { home: 2, away: 1 } : { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: matchId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
