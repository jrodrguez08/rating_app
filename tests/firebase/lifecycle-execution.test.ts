import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminFootballSyncStore } from "@/lib/firebase/server";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `lifecycle-execution-${Date.now()}`);
const database = getFirestore(app);
const store = new AdminFootballSyncStore(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("lifecycle execution coordination", () => {
  it("grants one concurrent lease and records sanitized timing metrics", async () => {
    const teamId = `team-lifecycle-lease-${Date.now()}`;
    const claims = await Promise.all([
      store.claimLifecycleExecution(teamId, "attempt-a", "scheduled"),
      store.claimLifecycleExecution(teamId, "attempt-b", "operator"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = claims[0] ? "attempt-a" : "attempt-b";

    await store.completeLifecycleExecution(teamId, winner, {
      action: "rating_ready",
      matchId: "match-lease",
      providerRequests: 3,
    });

    const metadata = (
      await database.doc(`footballSyncMetadata/${teamId}`).get()
    ).data();
    expect(metadata).toMatchObject({
      lastLifecycleAction: "rating_ready",
      lastLifecycleMatchId: "match-lease",
      lastLifecycleProviderRequests: 3,
    });
    expect(metadata?.lastLifecycleStartedAt).toBeDefined();
    expect(metadata?.lastLifecycleCompletedAt).toBeDefined();
    expect(metadata).not.toHaveProperty("lifecycleAttemptId");
    expect(metadata).not.toHaveProperty("lifecycleLeaseUntil");
  });
});
