import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminVerifiedCoachService } from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `verified-coach-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminVerifiedCoachService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});
afterAll(() => deleteApp(app));

describe("verified coach assignment persistence", () => {
  it("dry-runs without writes, applies idempotently, and rejects conflicts", async () => {
    const matchId = "verified-coach-dry-run";
    await seedMatch(matchId);
    const input = assignmentInput(matchId);

    await expect(service.assign(input, false)).resolves.toMatchObject({
      matchId,
      coachCreated: true,
      assignmentCreated: true,
    });
    expect((await database.doc("coaches/verified-coach-1").get()).exists).toBe(
      false,
    );
    expect(
      (
        await database
          .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
          .get()
      ).exists,
    ).toBe(false);

    await expect(service.assign(input, true)).resolves.toMatchObject({
      coachCreated: true,
      assignmentCreated: true,
    });
    await expect(service.assign(input, true)).resolves.toMatchObject({
      coachCreated: false,
      assignmentCreated: false,
    });
    expect(
      (
        await database
          .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
          .get()
      ).data(),
    ).toMatchObject({
      trackedTeamId: "team-verified",
      externalFixtureId: "fixture-1",
      coachId: "verified-coach-1",
      provenance: "operator_verified",
      verificationSource: "https://example.com/match-report",
    });
    await expect(
      service.assign({ ...input, coachId: "other-coach" }, true),
    ).rejects.toThrow(/conflicts/i);
  });

  it("serializes concurrent identical applies", async () => {
    const matchId = "verified-coach-concurrent";
    await seedMatch(matchId);
    await expect(
      Promise.all([
        service.assign(assignmentInput(matchId), true),
        service.assign(assignmentInput(matchId), true),
      ]),
    ).resolves.toHaveLength(2);
    expect(
      (
        await database
          .collection(`matches/${matchId}/verifiedCoachAssignments`)
          .get()
      ).size,
    ).toBe(1);
  });

  it("rejects wrong bindings, malformed evidence, ballots, and finalized results", async () => {
    const matchId = "verified-coach-invalid";
    await seedMatch(matchId);
    const input = assignmentInput(matchId);
    await expect(
      service.assign({ ...input, trackedTeamId: "wrong-team" }, false),
    ).rejects.toThrow(/Team or fixture/i);
    await expect(
      service.assign({ ...input, externalFixtureId: "wrong-fixture" }, false),
    ).rejects.toThrow(/Team or fixture/i);
    await expect(
      service.assign(
        { ...input, verificationSource: "http://example.com" },
        false,
      ),
    ).rejects.toThrow(/input is invalid/i);

    await database.doc(`matches/${matchId}/ballots/voter`).set({ any: true });
    await expect(service.assign(input, false)).rejects.toThrow(
      /not permitted/i,
    );
    await database.doc(`matches/${matchId}/ballots/voter`).delete();
    await database
      .doc(`matches/${matchId}/resultRevisions/reopen-1`)
      .set({ any: true });
    await expect(service.assign(input, false)).rejects.toThrow(
      /not permitted/i,
    );
    await database.doc(`matches/${matchId}/resultRevisions/reopen-1`).delete();
    await database.doc(`matches/${matchId}/results/summary`).set({ any: true });
    await expect(service.assign(input, false)).rejects.toThrow(
      /not permitted/i,
    );
  });
});

function assignmentInput(matchId: string) {
  return {
    matchId,
    trackedTeamId: "team-verified",
    externalFixtureId: "fixture-1",
    coachId: "verified-coach-1",
    coachName: "Verified Coach",
    verificationSource: "https://example.com/match-report",
    verificationReason: "Independent fixture-specific match report.",
    operatorId: "operator@example.com",
  };
}

async function seedMatch(matchId: string) {
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: "team-verified",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Tracked" },
    awayTeam: { externalProviderId: "900", name: "Opponent" },
    kickoffAt: new Date("2026-10-11T20:00:00.000Z"),
    status: "finished",
    ratingState: "preparing_rating",
    score: { home: 1, away: 0 },
    externalProvider: "api-football",
    externalProviderFixtureId: "fixture-1",
    createdAt: new Date("2026-10-11T00:00:00.000Z"),
    updatedAt: new Date("2026-10-11T22:00:00.000Z"),
  });
}
