import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { trackedMatchId } from "@/application/match-identity";
import {
  AdminBallotService,
  AdminFootballSyncStore,
  AdminResultService,
  AdminVotingWindowService,
} from "@/lib/firebase/server";

const projectId = "demo-rating-app-ballot-tests";
const now = new Date("2026-08-29T20:00:00.000Z");
const app = initializeApp({ projectId }, `ballot-tests-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminBallotService(database);
const teamId = "club-sport-herediano";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});
afterAll(() => deleteApp(app));

describe("trusted ballot persistence", () => {
  it("keeps ballots, eligibility, results, and comparisons separate for two clubs on one fixture", async () => {
    const heredianoId = trackedMatchId(
      "api-football",
      "phase2-shared-ballot-fixture",
      teamId,
    );
    const saprissaTeamId = "deportivo-saprissa";
    const saprissaId = trackedMatchId(
      "api-football",
      "phase2-shared-ballot-fixture",
      saprissaTeamId,
    );
    await seedMatch(heredianoId);
    await database.doc(`matches/${heredianoId}`).update({
      externalProviderFixtureId: "phase2-shared-ballot-fixture",
    });
    const source = (await database.doc(`matches/${heredianoId}`).get()).data();
    await database.doc(`matches/${saprissaId}`).set({
      ...source,
      trackedTeamId: saprissaTeamId,
      trackedTeamExternalProviderId: "200",
      votingClosesAt: Timestamp.fromDate(new Date("2026-08-29T23:00:00.000Z")),
    });
    const timestamp = Timestamp.fromDate(now);
    await database
      .doc(`matches/${saprissaId}/participants/saprissa-starter`)
      .set({
        matchId: saprissaId,
        playerId: "saprissa-starter",
        teamId: saprissaTeamId,
        externalProvider: "api-football",
        externalProviderTeamId: "200",
        externalProviderPlayerId: "saprissa-1",
        playerName: "Saprissa Starter",
        squadRole: "starter",
        starter: true,
        participated: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    await database
      .doc(`matches/${saprissaId}/coachAssignments/head-coach`)
      .set({
        matchId: saprissaId,
        coachId: "saprissa-coach",
        teamId: saprissaTeamId,
        externalProviderTeamId: "200",
        role: "head-coach",
        coachName: "Saprissa Coach",
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    expect((await service.getPageState(heredianoId, teamId, now)).state).toBe(
      "active",
    );
    const saprissaPage = await service.getPageState(
      saprissaId,
      saprissaTeamId,
      now,
    );
    expect(saprissaPage).toMatchObject({
      state: "active",
      context: {
        players: [{ id: "saprissa-starter" }],
        coach: { id: "saprissa-coach" },
      },
    });
    expect(await service.getPageState(saprissaId, teamId, now)).toEqual({
      state: "unavailable",
    });
    expect(
      await service.hasSubmitted(saprissaId, teamId, "same-voter"),
    ).toBeNull();
    expect(
      await service.submit(
        saprissaId,
        teamId,
        "same-voter",
        validRatings(),
        now,
      ),
    ).toEqual({ status: "invalid_match" });
    expect(
      await service.submit(
        heredianoId,
        teamId,
        "same-voter",
        validRatings(),
        now,
      ),
    ).toEqual({ status: "created" });
    const saprissaRatings = {
      playerRatings: { "saprissa-starter": 9 },
      coachRating: { coachId: "saprissa-coach", rating: 8 },
    };
    expect(
      await service.submit(
        saprissaId,
        saprissaTeamId,
        "same-voter",
        saprissaRatings,
        now,
      ),
    ).toEqual({ status: "created" });
    expect(
      await service.submit(
        saprissaId,
        saprissaTeamId,
        "same-voter",
        saprissaRatings,
        now,
      ),
    ).toEqual({ status: "already_submitted" });
    const store = new AdminFootballSyncStore(database);
    const originalMatch = await store.getMatch(heredianoId);
    await expect(
      store.upsertMatches([
        { ...originalMatch, trackedTeamId: saprissaTeamId },
      ]),
    ).rejects.toThrow("binding conflicts");
    expect((await store.getMatch(heredianoId)).trackedTeamId).toBe(teamId);
    const close = new Date("2026-08-29T22:00:00.000Z");
    await store.finalizeMatchResult(heredianoId, close);
    expect((await store.getMatch(saprissaId)).ratingState).toBe("rating_ready");
    expect(
      (await database.doc(`matches/${saprissaId}/results/summary`).get())
        .exists,
    ).toBe(false);
    await store.finalizeMatchResult(
      saprissaId,
      new Date("2026-08-29T23:00:00.000Z"),
    );
    const reader = new AdminResultService(database);
    expect((await reader.getPageState(heredianoId, teamId, close)).state).toBe(
      "ready",
    );
    expect(
      (await reader.getPageState(saprissaId, saprissaTeamId, close)).state,
    ).toBe("ready");
    expect(await reader.getPageState(saprissaId, teamId, close)).toEqual({
      state: "unavailable",
    });
    expect(
      await reader.getVoteComparison(saprissaId, teamId, "same-voter", close),
    ).toEqual({ status: "invalid_match" });
    expect(
      (
        await database.doc(`matches/${heredianoId}/results/summary`).get()
      ).data(),
    ).toMatchObject({
      teamId,
      ballotCount: 1,
      mvpPlayerIds: ["starter"],
      playerResults: { starter: { average: 8 }, "used-sub": { average: 7 } },
    });
    expect(
      (
        await database.doc(`matches/${saprissaId}/results/summary`).get()
      ).data(),
    ).toMatchObject({
      teamId: saprissaTeamId,
      ballotCount: 1,
      mvpPlayerIds: ["saprissa-starter"],
      playerResults: { "saprissa-starter": { average: 9 } },
    });
    const saprissaResult = (
      await database.doc(`matches/${saprissaId}/results/summary`).get()
    ).data();
    await new AdminVotingWindowService(database).reopen(
      heredianoId,
      new Date(Date.now() + 60 * 60 * 1000),
      true,
    );
    expect(
      (await database.doc(`matches/${heredianoId}/results/summary`).get())
        .exists,
    ).toBe(false);
    expect(
      (
        await database
          .doc(`matches/${heredianoId}/resultRevisions/reopen-0001`)
          .get()
      ).exists,
    ).toBe(true);
    expect(
      (
        await database.doc(`matches/${saprissaId}/results/summary`).get()
      ).data(),
    ).toEqual(saprissaResult);
    expect((await reader.getPageState(heredianoId, teamId)).state).toBe(
      "locked",
    );
    expect((await reader.getPageState(saprissaId, saprissaTeamId)).state).toBe(
      "ready",
    );
  });
  it("loads only exact eligible tracked-Team participants and coach", async () => {
    await seedMatch("context");
    const state = await service.getPageState("context", teamId, now);

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
      service.submit("valid", teamId, "voter-1", validRatings(), now),
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
      service.submit("race", teamId, "same-voter", firstRatings, now),
      service.submit("race", teamId, "same-voter", secondRatings, now),
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
        service.submit("two-voters", teamId, "voter-a", validRatings(), now),
        service.submit("two-voters", teamId, "voter-b", validRatings(), now),
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
      service.submit(matchId, teamId, "voter", ratings, now),
    ).resolves.toEqual({
      status: "invalid_ballot",
    });
  });

  it("rejects before and after the trusted window", async () => {
    await seedMatch("window");
    await expect(
      service.submit(
        "window",
        teamId,
        "early",
        validRatings(),
        new Date("2026-08-29T17:59:59.999Z"),
      ),
    ).resolves.toEqual({ status: "not_open" });
    await expect(
      service.submit(
        "window",
        teamId,
        "late",
        validRatings(),
        new Date("2026-08-29T22:00:00.000Z"),
      ),
    ).resolves.toEqual({ status: "closed" });
  });

  it("fails safely when the tracked-Team coach is inconsistent", async () => {
    await seedMatch("bad-coach", { coachTeamId: "opponent" });
    await expect(
      service.submit("bad-coach", teamId, "voter", validRatings(), now),
    ).resolves.toEqual({ status: "data_unavailable" });
  });

  it("rejects a coach linked to the opponent provider Team", async () => {
    await seedMatch("bad-provider-coach");
    await database
      .doc("matches/bad-provider-coach/coachAssignments/head-coach")
      .update({ externalProviderTeamId: "200" });
    expect(
      (await service.getPageState("bad-provider-coach", teamId, now)).state,
    ).toBe("unavailable");
    expect(
      await service.submit(
        "bad-provider-coach",
        teamId,
        "voter",
        validRatings(),
        now,
      ),
    ).toEqual({ status: "data_unavailable" });
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
    trackedTeamExternalProviderId: "815",
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
        externalProviderTeamId: participant.teamId === teamId ? "815" : "200",
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
