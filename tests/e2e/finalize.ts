import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import {
  AdminFootballSyncStore,
  AdminResultService,
} from "@/lib/firebase/server";

const projectId = "demo-rating-app-e2e";

function requireLocalEmulators(): void {
  if (
    process.env.GCLOUD_PROJECT !== projectId ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
  ) {
    throw new Error(
      "E2E result checks require the dedicated local demo emulators.",
    );
  }
}

export async function inspectVotedMatch(matchId: string, teamId: string) {
  requireLocalEmulators();
  const app = initializeApp(
    { projectId },
    `e2e-inspect-${crypto.randomUUID()}`,
  );
  try {
    const database = getFirestore(app);
    const match = await new AdminFootballSyncStore(database).getMatch(matchId);
    if (match.trackedTeamId !== teamId)
      throw new Error("Wrong E2E Team binding.");
    const [ballots, result, page] = await Promise.all([
      database.collection(`matches/${matchId}/ballots`).get(),
      database.doc(`matches/${matchId}/results/summary`).get(),
      new AdminResultService(database).getPublishedPageState(matchId, teamId),
    ]);
    return {
      ratingState: match.ratingState,
      ballotIds: ballots.docs.map((document) => document.id),
      resultExists: result.exists,
      page,
    };
  } finally {
    await deleteApp(app);
  }
}

export async function finalizeVotedMatch(matchId: string, teamId: string) {
  requireLocalEmulators();
  const app = initializeApp(
    { projectId },
    `e2e-finalize-${crypto.randomUUID()}`,
  );
  try {
    const database = getFirestore(app);
    const store = new AdminFootballSyncStore(database);
    const match = await store.getMatch(matchId);
    if (
      match.trackedTeamId !== teamId ||
      match.ratingState !== "rating_ready"
    ) {
      throw new Error("E2E Match is not ready for trusted finalization.");
    }
    const snapshot = await database.doc(`matches/${matchId}`).get();
    const closesAt = snapshot.get("votingClosesAt");
    if (!(closesAt instanceof Timestamp)) {
      throw new Error("E2E voting close timestamp is missing.");
    }
    await store.finalizeMatchResult(matchId, closesAt.toDate());
    const page = await new AdminResultService(database).getPublishedPageState(
      matchId,
      teamId,
      closesAt.toDate(),
    );
    if (page.state !== "ready" || page.podium === null) {
      throw new Error("E2E result did not become published.");
    }
    return page;
  } finally {
    await deleteApp(app);
  }
}
