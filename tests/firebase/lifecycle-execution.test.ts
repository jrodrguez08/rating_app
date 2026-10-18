import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminFootballSyncStore } from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `lifecycle-execution-${Date.now()}`);
const database = getFirestore(app);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("lifecycle execution coordination", () => {
  it("grants one concurrent lease and records sanitized timing metrics", async () => {
    const teamId = `team-lifecycle-lease-${Date.now()}`;
    const firstStore = new AdminFootballSyncStore(database);
    const secondStore = new AdminFootballSyncStore(database);
    const claims = await Promise.all([
      firstStore.claimLifecycleExecution(teamId, "attempt-a", "scheduled"),
      secondStore.claimLifecycleExecution(teamId, "attempt-b", "operator"),
    ]);
    expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(
      1,
    );
    expect(claims.filter((claim) => claim.status === "busy")).toHaveLength(1);
    const firstWon = claims[0].status === "claimed";
    const winner = firstWon ? "attempt-a" : "attempt-b";
    const winnerStore = firstWon ? firstStore : secondStore;

    expect(
      await winnerStore.markLifecycleExecutionTarget(teamId, "match-lease"),
    ).toBe(true);
    await winnerStore.completeLifecycleExecution(teamId, winner, {
      action: "rating_ready",
      matchId: "match-lease",
      providerRequests: 3,
    });

    const metadata = (
      await database.doc(`footballSyncMetadata/${teamId}`).get()
    ).data();
    expect(metadata).toMatchObject({
      lastLifecycleAction: "rating_ready",
      lastLifecycleAttemptId: winner,
      lastLifecycleMatchId: "match-lease",
      lastLifecycleProviderRequests: 3,
    });
    expect(metadata?.lastLifecycleStartedAt).toBeDefined();
    expect(metadata?.lastLifecycleCompletedAt).toBeDefined();
    expect(metadata).not.toHaveProperty("lifecycleAttemptId");
    expect(metadata).not.toHaveProperty("lifecycleLeaseUntil");
  });

  it("lets a stale lease be replaced without letting the old execution renew or release it", async () => {
    const teamId = `team-lifecycle-stale-${Date.now()}`;
    const oldStore = new AdminFootballSyncStore(database);
    const newStore = new AdminFootballSyncStore(database);
    await expect(
      oldStore.claimLifecycleExecution(teamId, "old-attempt", "scheduled"),
    ).resolves.toMatchObject({ status: "claimed" });
    await database.doc(`footballSyncMetadata/${teamId}`).update({
      lifecycleLeaseUntil: Timestamp.fromMillis(Date.now() - 1_000),
    });

    await expect(
      newStore.claimLifecycleExecution(teamId, "new-attempt", "operator"),
    ).resolves.toMatchObject({ status: "claimed" });
    await expect(
      oldStore.renewLifecycleExecution(teamId, "old-attempt"),
    ).resolves.toBe(false);
    await oldStore.completeLifecycleExecution(teamId, "old-attempt", {
      action: "idle",
      providerRequests: 0,
    });

    const metadata = (
      await database.doc(`footballSyncMetadata/${teamId}`).get()
    ).data();
    expect(metadata?.lifecycleAttemptId).toBe("new-attempt");
    expect(metadata?.lifecycleLeaseUntil).toBeDefined();
    expect(metadata).not.toHaveProperty("lastLifecycleAttemptId");
  });
});
