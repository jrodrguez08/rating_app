import {
  Timestamp,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";

import {
  CURRENT_MATCH_GRACE_MS,
  selectPublicMatch,
} from "@/application/public-match-selection";
import type { Match } from "@/domain/models";
import { getVotingWindowState } from "@/domain/voting-window";
import {
  emitOperationalLog,
  type OperationalLogger,
} from "@/lib/operational-log";

import { getServerFirestore } from "./server";

// A transport page, never a cap on eligible windows. Reopened windows may belong
// to arbitrarily old fixtures, so kickoff recency cannot restrict this query.
const WINDOW_PAGE_SIZE = 50;

export async function getPublicHomeMatch(
  teamId: string,
  now = new Date(),
  database: Firestore = getServerFirestore(),
  log: OperationalLogger = console.info,
): Promise<Match | null> {
  let queries = 0;
  let documents = 0;
  let completed = false;
  const read = async (query: Query) => {
    queries += 1;
    const snapshot = await query.get();
    documents += Math.max(1, snapshot.size);
    return snapshot;
  };
  const hydrate = (snapshot: {
    id: string;
    data(): Record<string, unknown>;
  }): Match =>
    ({
      ...Object.fromEntries(
        Object.entries(snapshot.data()).map(([key, value]) => [
          key,
          value instanceof Timestamp ? value.toDate().toISOString() : value,
        ]),
      ),
      id: snapshot.id,
    }) as Match;
  const select = (matches: Match[]) =>
    selectPublicMatch(
      matches.sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
      now,
    );
  try {
    const team = database
      .collection("matches")
      .where("trackedTeamId", "==", teamId);
    const windows = team
      .where("ratingState", "==", "rating_ready")
      .orderBy("kickoffAt", "desc")
      .limit(WINDOW_PAGE_SIZE);
    const candidates: Match[] = [];
    let page = await read(windows);
    while (true) {
      candidates.push(...page.docs.map(hydrate));
      if (page.size < WINDOW_PAGE_SIZE) break;
      page = await read(windows.startAfter(page.docs.at(-1)!));
    }
    const active = select(
      candidates.filter(
        (match) => getVotingWindowState(match, now) === "active",
      ),
    );
    if (active) {
      completed = true;
      return active;
    }

    const threshold = Timestamp.fromMillis(
      now.getTime() - CURRENT_MATCH_GRACE_MS,
    );
    const live = await read(
      team
        .where("status", "==", "live")
        .where("ratingState", "in", ["not_ready", "preparing_rating"])
        .where("kickoffAt", ">=", threshold)
        .where("kickoffAt", "<=", Timestamp.fromDate(now))
        .orderBy("kickoffAt", "asc")
        .limit(1),
    );
    if (!live.empty) {
      completed = true;
      return hydrate(live.docs[0]);
    }
    const upcoming = await read(
      team
        .where("status", "==", "scheduled")
        .where("ratingState", "==", "not_ready")
        .where("kickoffAt", ">=", threshold)
        .orderBy("kickoffAt", "asc")
        .limit(1),
    );
    if (!upcoming.empty) {
      completed = true;
      return hydrate(upcoming.docs[0]);
    }

    // These three predicates exactly cover isPublicHistoricalMatch. Each limit
    // selects the mathematical maximum of its bucket, rather than sampling it.
    const historical = await Promise.all([
      read(
        team
          .where("status", "==", "finished")
          .orderBy("kickoffAt", "desc")
          .limit(1),
      ),
      read(
        team
          .where("ratingState", "==", "rating_closed")
          .orderBy("kickoffAt", "desc")
          .limit(1),
      ),
      read(
        team
          .where("votingOpeningMode", "==", "manual")
          .orderBy("kickoffAt", "desc")
          .limit(1),
      ),
    ]);
    const selected = select(
      historical.flatMap((snapshot) => snapshot.docs.map(hydrate)),
    );
    completed = true;
    return selected ?? null;
  } finally {
    emitOperationalLog(log, "firestore.home_read", {
      teamId,
      queries,
      documentReads: documents,
      status: completed ? "completed" : "failed",
      expensive: documents > 100,
    });
  }
}
