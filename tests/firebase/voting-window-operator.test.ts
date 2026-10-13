import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { notifyVotingWindowOpenedIfPending } from "@/application/voting-window-notification";
import type { FootballDataProvider } from "@/domain/ports";
import { runMatchLifecycle } from "@/application/match-lifecycle";
import {
  AdminBallotService,
  AdminFootballSyncStore,
  AdminResultService,
  AdminVotingWindowNotificationStore,
  AdminVotingWindowService,
} from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `operator-window-tests-${Date.now()}`);
const database = getFirestore(app);
const store = new AdminFootballSyncStore(database);
const operator = new AdminVotingWindowService(database);
const notificationStore = new AdminVotingWindowNotificationStore(database);
const ballots = new AdminBallotService(database);
const results = new AdminResultService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});
afterAll(() => deleteApp(app));

describe("operator voting-window persistence", () => {
  it("dry-runs and atomically reopens without changing ballots or leaking the archived result", async () => {
    const matchId = "operator-reopen";
    await seedClosed(matchId);
    const ballotBefore = (
      await database.doc(`matches/${matchId}/ballots/voter-a`).get()
    ).data();
    const closesAt = new Date(Date.now() + 60 * 60 * 1000);

    const dryRun = await operator.reopen(matchId, closesAt, false);
    expect(dryRun).toMatchObject({
      operation: "reopen",
      matchId,
      current: {
        ratingState: "rating_closed",
        resultSummaryExists: true,
        ballotCount: 1,
        votingReopenCount: 0,
      },
      proposed: {
        effectiveVotingClosesAt: closesAt.toISOString(),
        archivePath: `matches/${matchId}/resultRevisions/reopen-0001`,
        finalizesImmediately: false,
      },
    });
    expect(
      (await database.doc(`matches/${matchId}`).get()).data()?.ratingState,
    ).toBe("rating_closed");
    expect(
      (await database.doc(`matches/${matchId}/results/summary`).get()).exists,
    ).toBe(true);

    await operator.reopen(matchId, closesAt, true);
    const reopened = (await database.doc(`matches/${matchId}`).get()).data();
    const archive = await database
      .doc(`matches/${matchId}/resultRevisions/reopen-0001`)
      .get();
    expect(reopened).toMatchObject({
      ratingState: "rating_ready",
      votingReopenCount: 1,
      votingOpenNotificationWindow: 1,
      votingOpenNotificationStatus: "pending",
      votingReopenedAt: expect.any(Timestamp),
      effectiveVotingOpensAt: expect.any(Timestamp),
      effectiveVotingClosesAt: Timestamp.fromDate(closesAt),
    });
    expect(reopened?.votingOpensAt).toBeInstanceOf(Timestamp);
    expect(reopened?.votingClosesAt).toBeInstanceOf(Timestamp);
    expect(archive.data()).toMatchObject({
      matchId,
      revision: 1,
      archiveReason: "voting_reopened",
      ballotCount: 1,
      generatedAt: expect.any(Timestamp),
      archivedAt: expect.any(Timestamp),
    });
    expect(
      (await database.doc(`matches/${matchId}/results/summary`).get()).exists,
    ).toBe(false);
    expect(
      (await database.doc(`matches/${matchId}/ballots/voter-a`).get()).data(),
    ).toEqual(ballotBefore);
    expect((await results.getPageState(matchId)).state).toBe("locked");
    expect(await results.getVoteComparison(matchId, "voter-a")).toEqual({
      status: "locked",
    });
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-1" });
    const notificationOutcomes = await Promise.all([
      notifyVotingWindowOpenedIfPending({
        matchId,
        store: notificationStore,
        notifier: { send },
      }),
      notifyVotingWindowOpenedIfPending({
        matchId,
        store: notificationStore,
        notifier: { send },
      }),
    ]);
    expect(notificationOutcomes).toContain("sent");
    expect(
      notificationOutcomes.every((outcome) =>
        ["sent", "in_flight", "already_sent"].includes(outcome),
      ),
    ).toBe(true);
    await expect(
      notifyVotingWindowOpenedIfPending({
        matchId,
        store: notificationStore,
        notifier: { send },
      }),
    ).resolves.toBe("already_sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId,
        windowSequence: 1,
        idempotencyKey: `voting-open/${matchId}/1`,
      }),
    );
    await expect(operator.reopen(matchId, closesAt, true)).rejects.toThrow(
      /closed rating window/i,
    );
  });

  it("early-closes a reopened window with old and new ballots in one current result", async () => {
    const matchId = "operator-close-reopened";
    await seedClosed(matchId);
    await operator.reopen(matchId, new Date(Date.now() + 60 * 60 * 1000), true);
    await expect(
      ballots.submit(matchId, "voter-b", ratings(10, 9), new Date()),
    ).resolves.toEqual({ status: "created" });
    const oldBallot = (
      await database.doc(`matches/${matchId}/ballots/voter-a`).get()
    ).data();
    const archivedBeforeClose = (
      await database.doc(`matches/${matchId}/resultRevisions/reopen-0001`).get()
    ).data();

    const plan = await operator.planClose(matchId);
    expect(plan).toMatchObject({
      operation: "close",
      current: { reopened: true, ballotCount: 2, resultSummaryExists: false },
      proposed: { finalizesImmediately: true },
    });
    expect(
      (await database.doc(`matches/${matchId}/results/summary`).get()).exists,
    ).toBe(false);

    await operator.close(matchId);
    expect(
      (await database.doc(`matches/${matchId}`).get()).data(),
    ).toMatchObject({
      ratingState: "rating_closed",
      votingClosedEarlyAt: expect.any(Timestamp),
    });
    expect(
      (await database.doc(`matches/${matchId}/results/summary`).get()).data(),
    ).toMatchObject({ ballotCount: 2, status: "final" });
    expect((await results.getPageState(matchId)).state).toBe("ready");
    expect(await results.getVoteComparison(matchId, "voter-b")).toMatchObject({
      status: "ready",
      comparison: {
        players: [{ id: "player-1", userRating: 10 }],
        coach: { id: "coach-1", userRating: 9 },
      },
    });
    expect(
      (await database.doc(`matches/${matchId}/ballots/voter-a`).get()).data(),
    ).toEqual(oldBallot);
    expect(
      (
        await database
          .doc(`matches/${matchId}/resultRevisions/reopen-0001`)
          .get()
      ).data(),
    ).toEqual(archivedBeforeClose);
    await expect(
      ballots.submit(matchId, "late-voter", ratings(7, 7), new Date()),
    ).resolves.toEqual({ status: "not_open" });
    await expect(operator.close(matchId)).rejects.toThrow(/active finished/i);
    const generatedAt = (
      await database.doc(`matches/${matchId}/results/summary`).get()
    ).data()?.generatedAt;
    await store.finalizeMatchResult(matchId, new Date(Date.now() + 120_000));
    expect(
      (await database.doc(`matches/${matchId}/results/summary`).get()).data()
        ?.generatedAt,
    ).toEqual(generatedAt);
  });

  it("dry-runs and early-closes an original active window without mutation", async () => {
    const matchId = "operator-close-original";
    await seedActive(matchId);
    const before = (await database.doc(`matches/${matchId}`).get()).data();
    const plan = await operator.planClose(matchId);
    expect(plan.current).toMatchObject({ reopened: false, ballotCount: 1 });
    expect((await database.doc(`matches/${matchId}`).get()).data()).toEqual(
      before,
    );
    expect(
      (await database.doc(`matches/${matchId}/results/summary`).get()).exists,
    ).toBe(false);
    await operator.close(matchId);
    expect(
      (await database.doc(`matches/${matchId}/results/summary`).get()).data(),
    ).toMatchObject({ ballotCount: 1 });
    expect((await results.getPageState(matchId)).state).toBe("ready");
    expect(await results.getVoteComparison(matchId, "voter-a")).toMatchObject({
      status: "ready",
      comparison: {
        players: [{ id: "player-1", userRating: 8 }],
        coach: { id: "coach-1", userRating: 7 },
      },
    });
  });

  it("aborts on an archive collision and on a concurrent reopen", async () => {
    const collisionId = "operator-archive-collision";
    await seedClosed(collisionId);
    await database
      .doc(`matches/${collisionId}/resultRevisions/reopen-0001`)
      .set({ unexpected: true });
    await expect(
      operator.reopen(collisionId, new Date(Date.now() + 60 * 60 * 1000), true),
    ).rejects.toThrow(/revision already exists/i);
    expect(
      (await database.doc(`matches/${collisionId}/results/summary`).get())
        .exists,
    ).toBe(true);

    const raceId = "operator-reopen-race";
    await seedClosed(raceId);
    const attempts = await Promise.allSettled([
      operator.reopen(raceId, new Date(Date.now() + 60 * 60 * 1000), true),
      operator.reopen(raceId, new Date(Date.now() + 60 * 60 * 1000), true),
    ]);
    expect(
      attempts.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
  });

  it("fails closed on invalid duration and malformed persisted ballots", async () => {
    const durationId = "operator-invalid-duration";
    await seedClosed(durationId);
    await expect(
      operator.reopen(durationId, new Date(Date.now() + 60_000), false),
    ).rejects.toThrow(/between 5 minutes and 24 hours/i);
    expect(
      (await database.doc(`matches/${durationId}/results/summary`).get())
        .exists,
    ).toBe(true);

    const malformedId = "operator-malformed-ballot";
    await seedClosed(malformedId);
    await database.doc(`matches/${malformedId}/ballots/voter-a`).update({
      playerRatings: {},
    });
    await expect(
      operator.reopen(malformedId, new Date(Date.now() + 60 * 60 * 1000), true),
    ).rejects.toThrow(/malformed/i);
    expect(
      (await database.doc(`matches/${malformedId}/results/summary`).get())
        .exists,
    ).toBe(true);
    expect(
      (
        await database
          .doc(`matches/${malformedId}/resultRevisions/reopen-0001`)
          .get()
      ).exists,
    ).toBe(false);

    const malformedResultId = "operator-malformed-result";
    await seedClosed(malformedResultId);
    await database
      .doc(`matches/${malformedResultId}/results/summary`)
      .update({ ballotCount: 99 });
    await expect(
      operator.reopen(
        malformedResultId,
        new Date(Date.now() + 60 * 60 * 1000),
        true,
      ),
    ).rejects.toThrow(/result summary is malformed or inconsistent/i);
    expect(
      (await database.doc(`matches/${malformedResultId}/results/summary`).get())
        .exists,
    ).toBe(true);
    expect(
      (
        await database
          .doc(`matches/${malformedResultId}/resultRevisions/reopen-0001`)
          .get()
      ).exists,
    ).toBe(false);
  });

  it("lets normal lifecycle auto-finalize a reopened window", async () => {
    const matchId = "operator-auto-close";
    await seedClosed(matchId);
    const closesAt = new Date(Date.now() + 5 * 60 * 1000 + 5_000);
    await operator.reopen(matchId, closesAt, true);
    await expect(
      ballots.submit(matchId, "voter-b", ratings(10, 9), new Date()),
    ).resolves.toEqual({ status: "created" });
    await database.doc("teams/team-operator").set({
      displayName: "Tracked Team",
      shortName: "Tracked",
      countryName: "Costa Rica",
      countryCode: "CR",
      brandingKey: "tracked",
      externalProviderId: "815",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    const provider = providerThatMustNotRun();
    const outcome = await runMatchLifecycle({
      teamId: "team-operator",
      provider,
      store,
      now: () => new Date(closesAt.getTime() + 1),
      discoverFixtures: async () => {
        throw new Error("must not discover");
      },
      syncParticipants: async () => {
        throw new Error("must not sync");
      },
    });
    expect(outcome).toMatchObject({ action: "rating_closed", matchId });
    expect(
      (await database.doc(`matches/${matchId}/results/summary`).get()).data(),
    ).toMatchObject({ ballotCount: 2 });
  });
});

async function seedClosed(matchId: string) {
  const closesAt = new Date(Date.now() - 60_000);
  await seedMatch(
    matchId,
    new Date(closesAt.getTime() - 2 * 60 * 60 * 1000),
    closesAt,
  );
  await store.finalizeMatchResult(matchId, closesAt);
}

async function seedActive(matchId: string) {
  await seedMatch(
    matchId,
    new Date(Date.now() - 60 * 60 * 1000),
    new Date(Date.now() + 60 * 60 * 1000),
  );
}

async function seedMatch(matchId: string, opensAt: Date, closesAt: Date) {
  const timestamp = Timestamp.now();
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: "team-operator",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Tracked" },
    awayTeam: { externalProviderId: "2", name: "Opponent" },
    kickoffAt: Timestamp.fromMillis(opensAt.getTime() - 2 * 60 * 60 * 1000),
    status: "finished",
    ratingState: "rating_ready",
    score: { home: 2, away: 1 },
    ratingReadyAt: Timestamp.fromDate(opensAt),
    votingOpensAt: Timestamp.fromDate(opensAt),
    votingClosesAt: Timestamp.fromDate(closesAt),
    externalProvider: "api-football",
    externalProviderFixtureId: matchId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc(`matches/${matchId}/participants/player-1`).set({
    matchId,
    playerId: "player-1",
    teamId: "team-operator",
    externalProvider: "api-football",
    externalProviderTeamId: "815",
    externalProviderPlayerId: "1",
    playerName: "Player",
    position: "Midfielder",
    squadRole: "starter",
    starter: true,
    participated: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc(`matches/${matchId}/coachAssignments/head-coach`).set({
    matchId,
    coachId: "coach-1",
    teamId: "team-operator",
    externalProviderTeamId: "815",
    role: "head-coach",
    coachName: "Coach",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc(`matches/${matchId}/ballots/voter-a`).set({
    matchId,
    voterId: "voter-a",
    teamId: "team-operator",
    playerRatings: { "player-1": 8 },
    coachRating: { coachId: "coach-1", rating: 7 },
    submittedAt: timestamp,
  });
}

function ratings(player: number, coach: number) {
  return {
    playerRatings: { "player-1": player },
    coachRating: { coachId: "coach-1", rating: coach },
  };
}

function providerThatMustNotRun(): FootballDataProvider {
  const unexpected = async (): Promise<never> => {
    throw new Error("Provider must not run.");
  };
  return {
    name: "api-football",
    requestCount: 0,
    resolveTeam: unexpected,
    getCompetitionSeasons: unexpected,
    getFixtures: unexpected,
    getFixture: unexpected,
    getMatchContext: unexpected,
    getLineupContext: unexpected,
    getSquad: unexpected,
  };
}
