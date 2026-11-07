import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, expect, it, vi } from "vitest";

import { runMatchLifecycle } from "@/application/match-lifecycle";
import type { ClubSlug } from "@/config/club";
import {
  FINAL_SCORE_MAX_ATTEMPTS,
  FINAL_SCORE_RETRY_MS,
} from "@/domain/final-score";
import type { FootballDataProvider, ProviderFixture } from "@/domain/ports";
import {
  AdminFootballSyncStore,
  AdminMatchArchiveService,
} from "@/lib/firebase/server";

import { wrappedMatch, wrappedTeam } from "../wrapped-fixtures";
import { measureReads } from "./read-counts";

const app = initializeApp(
  { projectId: "demo-final-score-170" },
  "final-score-170",
);
const database = getFirestore(app);
const store = new AdminFootballSyncStore(database);
const start = new Date();
afterAll(() => deleteApp(app));

async function seed(
  club: ClubSlug,
  fixtureId: string,
  status: "live" | "scheduled",
) {
  const team = wrappedTeam(club);
  const match = wrappedMatch(club, fixtureId, {
    status,
    ratingState: "rating_ready",
    score: { home: null, away: null },
  });
  const ref = database.doc(`matches/${match.id}`);
  const batch = database.batch();
  batch.set(database.doc(`teams/${team.id}`), team);
  batch.set(ref, {
    ...match,
    kickoffAt: Timestamp.fromDate(new Date(match.kickoffAt)),
    votingOpeningMode: "manual",
    manualFinalWhistleAttestedAt: match.votingOpensAt,
    nextFinalScoreCheckAt: Timestamp.fromMillis(start.getTime() - 1),
    finalScoreCheckState: "pending",
  });
  batch.set(ref.collection("finalWhistleAttestations").doc("manual"), {
    matchId: match.id,
    trackedTeamId: team.id,
    actualMatchEnded: true,
  });
  batch.set(ref.collection("participants").doc("player"), {
    matchId: match.id,
    teamId: team.id,
    playerId: "player",
    playerName: "Player",
    participated: true,
  });
  batch.set(ref.collection("coachAssignments").doc("head-coach"), {
    matchId: match.id,
    teamId: team.id,
    coachId: "coach",
    coachName: "Coach",
  });
  batch.set(ref.collection("ballots").doc("voter"), {
    matchId: match.id,
    teamId: team.id,
    voterId: "voter",
    playerRatings: { player: 8 },
    coachRating: { coachId: "coach", rating: 7 },
  });
  await batch.commit();
  const response: ProviderFixture = {
    ...match,
    externalFixtureId: fixtureId,
    externalCompetitionId: "1",
    providerSeason: 2025,
    status: "finished",
    score: { home: 0, away: 2 },
  };
  return { team, match, ref, response };
}

function provider(fetchFixture: (id: string) => Promise<ProviderFixture>) {
  let count = 0;
  return {
    name: "api-football",
    get requestCount() {
      return count;
    },
    getFixture: vi.fn((id: string) => {
      count++;
      return fetchFixture(id);
    }),
  } as unknown as FootballDataProvider;
}

async function run(teamId: string, feed: FootballDataProvider, now = start) {
  await store.setSyncMetadata({
    teamId,
    lastFixtureDiscoveryAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  return runMatchLifecycle({
    teamId,
    provider: feed,
    store,
    now: () => now,
    discoverFixtures: async () => {
      throw new Error("Unexpected discovery");
    },
    syncParticipants: async () => {
      throw new Error("Unexpected participant sync");
    },
  });
}

it("finalizes expired voting first, then reconciles each tracked club independently and projects the same orientation", async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Firestore emulator required.");
  const home = await seed("herediano", "170", "live");
  const away = await seed("saprissa", "170", "scheduled");
  expect(home.match.id).not.toBe(away.match.id);
  for (const entry of [home, away]) {
    const fixtureFeed = provider(async () => entry.response);
    await expect(run(entry.team.id, fixtureFeed)).resolves.toMatchObject({
      action: "rating_closed",
      providerRequests: 0,
    });
    const summaryRef = entry.ref.collection("results").doc("summary");
    const summary = await summaryRef.get();
    expect(summary.data()).toMatchObject({ ballotCount: 1, status: "final" });
    const old = (await entry.ref.get()).data();
    const ballot = await entry.ref.collection("ballots").doc("voter").get();
    await expect(run(entry.team.id, fixtureFeed)).resolves.toMatchObject({
      action: "refreshed",
      providerRequests: 1,
    });
    const changed = (await entry.ref.get()).data();
    expect(changed).toMatchObject({
      status: "finished",
      score: { home: 0, away: 2 },
      finalScoreCheckState: "reconciled",
      ratingState: "rating_closed",
      votingOpensAt: old?.votingOpensAt,
      votingClosesAt: old?.votingClosesAt,
      manualFinalWhistleAttestedAt: old?.manualFinalWhistleAttestedAt,
    });
    expect(changed?.nextFinalScoreCheckAt).toBeUndefined();
    expect((await summaryRef.get()).updateTime).toEqual(summary.updateTime);
    expect((await ballot.ref.get()).updateTime).toEqual(ballot.updateTime);
    const featured = wrappedMatch(entry.team.brandingKey as ClubSlug, "178", {
      kickoffAt: "2025-06-03T18:00:00.000Z",
    });
    await database.doc(`matches/${featured.id}`).set({
      ...featured,
      kickoffAt: Timestamp.fromDate(new Date(featured.kickoffAt)),
    });
    const archive = await new AdminMatchArchiveService(database).list(
      entry.team.id,
      start,
    );
    expect(archive.recent).toContainEqual(
      expect.objectContaining({
        hasResults: true,
        match: expect.objectContaining({
          id: entry.match.id,
          status: "finished",
          score: { home: 0, away: 2 },
        }),
      }),
    );
    await store.upsertMatches([
      { ...entry.match, score: { home: null, away: null } },
    ]);
    expect((await entry.ref.get()).data()).toMatchObject({
      status: "finished",
      score: { home: 0, away: 2 },
    });
    expect(await store.findDueFinalScore(entry.team.id, start)).toBeNull();
    if (entry === home)
      expect((await away.ref.get()).data()?.status).toBe("scheduled");
  }
});

it("reserves one attempt across competing stores, fences changed data, and exhausts failed checks", async () => {
  const { team, match, ref, response } = await seed("herediano", "171", "live");
  await ref.update({ ratingState: "rating_closed" });
  const second = new AdminFootballSyncStore(database);
  const claims = await Promise.all(
    [store, second].map((writer) =>
      writer.claimFinalScoreCheck(team, match.id, start),
    ),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
  const attempt = claims.find((value) => value !== null)!;
  expect(await store.findDueFinalScore(team.id, start)).toBeNull();
  await ref.update({ score: { home: 1, away: null } });
  expect(
    await store.commitFinalScore(attempt, "api-football", response, start),
  ).toBe(false);
  const failing = provider(async () => {
    throw new Error("synthetic provider failure");
  });
  let time = new Date(start.getTime() + FINAL_SCORE_RETRY_MS);
  for (let i = 1; i < FINAL_SCORE_MAX_ATTEMPTS; i++) {
    const data = (await ref.get()).data();
    time = data?.nextFinalScoreCheckAt.toDate() ?? time;
    expect(
      await store.findDueFinalScore(team.id, new Date(time.getTime() - 1)),
    ).toBeNull();
    await expect(run(team.id, failing, time)).resolves.toMatchObject({
      reason: "request_or_commit_failed",
    });
  }
  expect((await ref.get()).data()).toMatchObject({
    status: "live",
    score: { home: 1, away: null },
    finalScoreCheckAttempts: FINAL_SCORE_MAX_ATTEMPTS,
    finalScoreCheckState: "exhausted",
  });
  expect(
    await store.findDueFinalScore(
      team.id,
      new Date(time.getTime() + FINAL_SCORE_RETRY_MS),
    ),
  ).toBeNull();
});

it("selects indexed operational and due candidates without reading closed history", async () => {
  const { team, ref } = await seed("saprissa", "172", "scheduled");
  await ref.update({ ratingState: "rating_closed" });
  const batch = database.batch();
  for (let i = 0; i < 70; i++) {
    const match = wrappedMatch("saprissa", String(300 + i));
    batch.set(database.doc(`matches/${match.id}`), {
      ...match,
      kickoffAt: Timestamp.fromDate(new Date(match.kickoffAt)),
    });
  }
  await batch.commit();
  const reads = await measureReads(() =>
    store.listLifecycleMatches(team.id, start),
  );
  expect(reads.queries).toBe(6);
  expect(reads.documents).toBe(6);
  const due = await measureReads(() => store.findDueFinalScore(team.id, start));
  expect(due).toMatchObject({ value: ref.id, documents: 1, queries: 1 });
});
