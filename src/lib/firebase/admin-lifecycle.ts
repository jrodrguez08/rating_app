import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { selectLifecycleMatch } from "@/application/match-lifecycle";
import type { Match, MatchParticipant } from "@/domain/models";
import {
  adminLifecycleAuditId,
  hashAdminLifecycleAction,
  type AdminLifecycleAction,
} from "@/lib/server/admin-lifecycle-action";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";

import { getServerFirestore } from "./server";

const REQUEST_INTERVAL_MS = 60_000;
const RECENT_FINISHED_MS = 12 * 60 * 60 * 1000;

export interface AdminLifecycleInput extends AdminLifecycleAction {
  operatorId: string;
}

export interface AdminLifecyclePlan {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  status: Match["status"];
  ratingState: Match["ratingState"];
  confirmedStarters: number;
  confirmedSubstitutes: number;
  unconfirmedOrUnused: number;
  headCoachReady: boolean;
  lineupProvenance: "provider" | "operator_verified" | "unavailable";
  lastProviderSyncAt?: string;
  finishedObservedAt?: string;
  participantSyncedAt?: string;
  ratingReadyAt?: string;
}

export interface AdminLifecycleCommit {
  auditId: string;
  disposition: "committed" | "idempotent_retry";
}

export class AdminLifecycleRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminLifecycleRejectedError";
  }
}

export class AdminLifecycleService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async preview(input: AdminLifecycleInput): Promise<AdminLifecyclePlan> {
    const matchReference = this.database.doc(`matches/${input.matchId}`);
    const teamMatches = this.database
      .collection("matches")
      .where("trackedTeamId", "==", input.trackedTeamId);
    const [matchSnapshot, matchSnapshots, participants, coach, verifiedLineup] =
      await Promise.all([
        matchReference.get(),
        teamMatches.get(),
        matchReference.collection("participants").get(),
        matchReference.collection("coachAssignments").doc("head-coach").get(),
        matchReference.collection("verifiedLineups").doc("current").get(),
      ]);
    if (!matchSnapshot.exists) {
      throw new AdminLifecycleRejectedError("Match was not found.");
    }
    const match = fromSnapshot<Match>(matchSnapshot);
    validateTarget(input, match, matchSnapshot.readTime.toDate());
    validateCanonicalSelection(
      input.matchId,
      matchSnapshots.docs.map((snapshot) => fromSnapshot<Match>(snapshot)),
      matchSnapshot.readTime.toDate(),
    );
    return buildPlan(
      match,
      participants.docs.map((snapshot) =>
        fromSnapshot<MatchParticipant>(snapshot),
      ),
      coach.exists && coach.data()?.teamId === input.trackedTeamId,
      verifiedLineup.exists,
    );
  }

  async applyAuthorized(
    input: AdminLifecycleInput,
    challengeToken: string | undefined,
  ): Promise<AdminLifecycleCommit> {
    if (!challengeToken || challengeToken.length > 256) {
      throw new AdminLifecycleRejectedError(
        "Admin action challenge is invalid.",
      );
    }
    const challengeId = adminChallengeDocumentId(challengeToken);
    const auditId = adminLifecycleAuditId(challengeId);
    const actionHash = hashAdminLifecycleAction(input);
    return this.database.runTransaction(async (transaction) => {
      const challengeReference = this.database.doc(
        `adminActionChallenges/${challengeId}`,
      );
      const auditReference = this.database.doc(`adminAudit/${auditId}`);
      const matchReference = this.database.doc(`matches/${input.matchId}`);
      const teamMatches = this.database
        .collection("matches")
        .where("trackedTeamId", "==", input.trackedTeamId);
      const [challengeSnapshot, matchSnapshot, matchSnapshots] =
        await Promise.all([
          transaction.get(challengeReference),
          transaction.get(matchReference),
          transaction.get(teamMatches),
        ]);
      const challenge = challengeSnapshot.data();
      if (
        !challengeSnapshot.exists ||
        challenge?.operatorUid !== input.operatorId ||
        challenge.matchId !== input.matchId ||
        challenge.actionHash !== actionHash ||
        !(challenge.expiresAt instanceof Timestamp)
      ) {
        throw new AdminLifecycleRejectedError(
          "Admin action challenge is invalid.",
        );
      }
      if (challenge.consumedAt !== undefined) {
        const audit = await transaction.get(auditReference);
        if (
          challenge.committedAuditId !== auditId ||
          !audit.exists ||
          audit.data()?.operatorUid !== input.operatorId ||
          audit.data()?.action !== "lifecycle_request_apply" ||
          audit.data()?.matchId !== input.matchId ||
          audit.data()?.trackedTeamId !== input.trackedTeamId ||
          audit.data()?.externalFixtureId !== input.externalFixtureId ||
          audit.data()?.actionHash !== actionHash ||
          audit.data()?.outcome !== "success" ||
          audit.data()?.commitDisposition !== "committed" ||
          !(audit.data()?.createdAt instanceof Timestamp)
        ) {
          throw new AdminLifecycleRejectedError(
            "Admin action challenge is invalid.",
          );
        }
        return { auditId, disposition: "idempotent_retry" };
      }
      if (
        challenge.expiresAt.toMillis() <= challengeSnapshot.readTime.toMillis()
      ) {
        throw new AdminLifecycleRejectedError(
          "Admin action challenge is invalid.",
        );
      }
      if (!matchSnapshot.exists) {
        throw new AdminLifecycleRejectedError("Match was not found.");
      }
      const match = fromSnapshot<Match>(matchSnapshot);
      const now = matchSnapshot.readTime.toDate();
      validateTarget(input, match, now);
      validateCanonicalSelection(
        input.matchId,
        matchSnapshots.docs.map((snapshot) => fromSnapshot<Match>(snapshot)),
        now,
      );
      const previousRequest = match.lastLifecycleRequestedAt
        ? Date.parse(match.lastLifecycleRequestedAt)
        : 0;
      if (now.getTime() - previousRequest < REQUEST_INTERVAL_MS) {
        throw new AdminLifecycleRejectedError("Lifecycle request rate limit.");
      }
      transaction.update(matchReference, {
        lastLifecycleRequestedAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
      transaction.update(challengeReference, {
        consumedAt: Timestamp.fromDate(now),
        committedAuditId: auditId,
      });
      transaction.create(auditReference, {
        operatorUid: input.operatorId,
        action: "lifecycle_request_apply",
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: input.externalFixtureId,
        actionHash,
        outcome: "success",
        commitDisposition: "committed",
        createdAt: Timestamp.fromDate(now),
      });
      return { auditId, disposition: "committed" };
    });
  }
}

function validateCanonicalSelection(
  matchId: string,
  matches: Match[],
  now: Date,
) {
  if (selectLifecycleMatch(matches, now)?.id !== matchId) {
    throw new AdminLifecycleRejectedError(
      "Lifecycle request target is not the canonical match.",
    );
  }
}

function validateTarget(input: AdminLifecycleInput, match: Match, now: Date) {
  if (
    match.trackedTeamId !== input.trackedTeamId ||
    match.externalProviderFixtureId !== input.externalFixtureId
  ) {
    throw new AdminLifecycleRejectedError(
      "The Team or fixture binding is invalid.",
    );
  }
  const recentFinished =
    match.status === "finished" &&
    now.getTime() - Date.parse(match.finishedObservedAt ?? match.kickoffAt) <=
      RECENT_FINISHED_MS;
  if (
    (match.status !== "live" && !recentFinished) ||
    !["not_ready", "preparing_rating"].includes(match.ratingState)
  ) {
    throw new AdminLifecycleRejectedError(
      "Lifecycle request is not permitted for this match state.",
    );
  }
}

function buildPlan(
  match: Match,
  participants: MatchParticipant[],
  headCoachReady: boolean,
  hasVerifiedLineup: boolean,
): AdminLifecyclePlan {
  const tracked = participants.filter(
    (participant) => participant.teamId === match.trackedTeamId,
  );
  const confirmedStarters = tracked.filter(
    (participant) =>
      participant.participationStatus === "confirmed_starter" ||
      (participant.starter && participant.participated),
  ).length;
  const confirmedSubstitutes = tracked.filter(
    (participant) => participant.participationStatus === "confirmed_substitute",
  ).length;
  return {
    matchId: match.id,
    trackedTeamId: match.trackedTeamId,
    externalFixtureId: match.externalProviderFixtureId,
    status: match.status,
    ratingState: match.ratingState,
    confirmedStarters,
    confirmedSubstitutes,
    unconfirmedOrUnused: Math.max(
      0,
      tracked.length - confirmedStarters - confirmedSubstitutes,
    ),
    headCoachReady,
    lineupProvenance: hasVerifiedLineup
      ? "operator_verified"
      : match.lineupSnapshotAt
        ? "provider"
        : "unavailable",
    ...(match.lastProviderSyncAt
      ? { lastProviderSyncAt: match.lastProviderSyncAt }
      : {}),
    ...(match.finishedObservedAt
      ? { finishedObservedAt: match.finishedObservedAt }
      : {}),
    ...(match.participantSyncedAt
      ? { participantSyncedAt: match.participantSyncedAt }
      : {}),
    ...(match.ratingReadyAt ? { ratingReadyAt: match.ratingReadyAt } : {}),
  };
}

function fromSnapshot<T>(snapshot: {
  id: string;
  data(): Record<string, unknown> | undefined;
}): T {
  const data = snapshot.data() ?? {};
  return {
    ...Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof Timestamp ? value.toDate().toISOString() : value,
      ]),
    ),
    id: snapshot.id,
  } as T;
}
