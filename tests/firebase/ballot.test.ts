import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminBallotService } from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const now = new Date("2026-08-29T20:00:00.000Z");
const app = initializeApp({ projectId }, `ballot-tests-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminBallotService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});
afterAll(() => deleteApp(app));

describe("trusted ballot persistence", () => {
  it("loads only exact eligible tracked-Team participants and coach", async () => {
    await seedMatch("context");
    const state = await service.getPageState("context", now);

    expect(state).toMatchObject({
      state: "active",
      context: {
        players: [
          { id: "starter", name: "Starter", substitute: false },
          { id: "used-sub", name: "Used Substitute", substitute: true },
        ],
        coach: { id: "coach-1", name: "Head Coach" },
      },
    });
    if (state.state !== "active") throw new Error("Expected active context.");
    expect(state.context.players.map((player) => player.id)).not.toContain(
      "unused-sub",
    );
    expect(state.context.players.map((player) => player.id)).not.toContain(
      "opponent",
    );
  });

  it("creates one compact server-timestamped ballot at the voter path", async () => {
    await seedMatch("valid");
    await expect(
      service.submit("valid", "voter-1", validRatings(), now),
    ).resolves.toEqual({ status: "created" });
    const snapshot = await database.doc("matches/valid/ballots/voter-1").get();

    expect(snapshot.exists).toBe(true);
    expect(snapshot.data()).toMatchObject({
      matchId: "valid",
      voterId: "voter-1",
      teamId: "club-sport-herediano",
      playerRatings: { starter: 8, "used-sub": 7 },
      coachRating: { coachId: "coach-1", rating: 9 },
      submittedAt: expect.any(Timestamp),
    });
    expect(Object.keys(snapshot.data() ?? {}).sort()).toEqual(
      [
        "coachRating",
        "matchId",
        "playerRatings",
        "submittedAt",
        "teamId",
        "voterId",
      ].sort(),
    );
  });

  it("allows exactly one winner in a concurrent duplicate race", async () => {
    await seedMatch("race");
    const firstRatings = validRatings();
    const secondRatings = {
      ...validRatings(),
      playerRatings: { starter: 2, "used-sub": 3 },
    };
    const results = await Promise.all([
      service.submit("race", "same-voter", firstRatings, now),
      service.submit("race", "same-voter", secondRatings, now),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "already_submitted",
      "created",
    ]);
    const stored = (
      await database.doc("matches/race/ballots/same-voter").get()
    ).data();
    expect([
      firstRatings.playerRatings,
      secondRatings.playerRatings,
    ]).toContainEqual(stored?.playerRatings);
  });

  it("allows a different UID to create its own deterministic ballot", async () => {
    await seedMatch("two-voters");
    await expect(
      Promise.all([
        service.submit("two-voters", "voter-a", validRatings(), now),
        service.submit("two-voters", "voter-b", validRatings(), now),
      ]),
    ).resolves.toEqual([{ status: "created" }, { status: "created" }]);
  });

  it.each([
    ["missing rating", { ...validRatings(), playerRatings: { starter: 8 } }],
    [
      "extra or opponent rating",
      {
        ...validRatings(),
        playerRatings: { ...validRatings().playerRatings, opponent: 5 },
      },
    ],
    [
      "unused substitute rating",
      {
        ...validRatings(),
        playerRatings: { ...validRatings().playerRatings, "unused-sub": 5 },
      },
    ],
    [
      "wrong coach",
      {
        ...validRatings(),
        coachRating: { coachId: "opponent-coach", rating: 8 },
      },
    ],
    [
      "coach 0",
      { ...validRatings(), coachRating: { coachId: "coach-1", rating: 0 } },
    ],
    [
      "player 11",
      { ...validRatings(), playerRatings: { starter: 11, "used-sub": 7 } },
    ],
    [
      "fractional rating",
      { ...validRatings(), playerRatings: { starter: 8.5, "used-sub": 7 } },
    ],
    ["unexpected field", { ...validRatings(), matchId: "other" }],
  ])("rejects %s", async (label, ratings) => {
    const matchId = `invalid-${label.replaceAll(" ", "-")}`;
    await seedMatch(matchId);
    await expect(
      service.submit(matchId, "voter", ratings, now),
    ).resolves.toEqual({
      status: "invalid_ballot",
    });
  });

  it("rejects before and after the trusted window", async () => {
    await seedMatch("window");
    await expect(
      service.submit(
        "window",
        "early",
        validRatings(),
        new Date("2026-08-29T17:59:59.999Z"),
      ),
    ).resolves.toEqual({ status: "not_open" });
    await expect(
      service.submit(
        "window",
        "late",
        validRatings(),
        new Date("2026-08-29T22:00:00.000Z"),
      ),
    ).resolves.toEqual({ status: "closed" });
  });

  it("fails safely when the tracked-Team coach is inconsistent", async () => {
    await seedMatch("bad-coach", { coachTeamId: "opponent" });
    await expect(
      service.submit("bad-coach", "voter", validRatings(), now),
    ).resolves.toEqual({ status: "data_unavailable" });
  });
});

function validRatings() {
  return {
    playerRatings: { starter: 8, "used-sub": 7 },
    coachRating: { coachId: "coach-1", rating: 9 },
  };
}

async function seedMatch(
  matchId: string,
  options: { coachTeamId?: string } = {},
) {
  const teamId = "club-sport-herediano";
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: teamId,
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "200", name: "Opponent" },
    kickoffAt: Timestamp.fromDate(new Date("2026-08-29T16:00:00.000Z")),
    status: "finished",
    ratingState: "rating_ready",
    score: { home: 2, away: 1 },
    votingOpensAt: Timestamp.fromDate(new Date("2026-08-29T18:00:00.000Z")),
    votingClosesAt: Timestamp.fromDate(new Date("2026-08-29T22:00:00.000Z")),
    externalProvider: "api-football",
    externalProviderFixtureId: matchId,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
  const participants = [
    {
      id: "starter",
      teamId,
      participated: true,
      squadRole: "starter",
      name: "Starter",
    },
    {
      id: "used-sub",
      teamId,
      participated: true,
      squadRole: "substitute",
      name: "Used Substitute",
    },
    {
      id: "unused-sub",
      teamId,
      participated: false,
      squadRole: "substitute",
      name: "Unused Substitute",
    },
    {
      id: "opponent",
      teamId: "opponent",
      participated: true,
      squadRole: "starter",
      name: "Opponent Player",
    },
  ];
  await Promise.all(
    participants.map((participant, index) =>
      database.doc(`matches/${matchId}/participants/${participant.id}`).set({
        matchId,
        playerId: participant.id,
        teamId: participant.teamId,
        externalProvider: "api-football",
        externalProviderTeamId: participant.teamId,
        externalProviderPlayerId: participant.id,
        playerName: participant.name,
        shirtNumber: index + 1,
        position: index === 0 ? "Goalkeeper" : "Midfielder",
        squadRole: participant.squadRole,
        starter: participant.squadRole === "starter",
        participated: participant.participated,
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      }),
    ),
  );
  await database.doc(`matches/${matchId}/coachAssignments/head-coach`).set({
    matchId,
    coachId: "coach-1",
    teamId: options.coachTeamId ?? teamId,
    externalProviderTeamId: "815",
    role: "head-coach",
    coachName: "Head Coach",
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  });
}
