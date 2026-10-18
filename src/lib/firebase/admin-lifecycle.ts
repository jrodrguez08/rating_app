import { randomUUID } from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { selectLifecycleMatch } from "@/application/match-lifecycle";
import type { Match, MatchParticipant } from "@/domain/models";
import type { LifecycleExecutionClaim } from "@/domain/ports";
import {
  adminLifecycleAuditId,
  hashAdminLifecycleAction,
  type AdminLifecycleAction,
} from "@/lib/server/admin-lifecycle-action";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";

import { getServerFirestore } from "./server";

const REQUEST_INTERVAL_MS = 60_000;
const RECENT_FINISHED_MS = 12 * 60 * 60 * 1000;
const RETRY_LIFETIME_MS = 10 * 60 * 1000;
const REQUEST_LEASE_MS = 75_000;
const BUSY_BACKOFF_MS = 5_000;
const FAILURE_BACKOFF_MS = 15_000;
const MAX_REQUEST_ATTEMPTS = 5;
const MAX_PROVIDER_EXECUTIONS = 3;

export type AdminLifecycleExecutionStatus =
  | "requested"
  | "running"
  | "skipped_busy"
  | "completed"
  | "failed"
  | "voting_open";

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

export interface AdminLifecycleReceipt {
  auditId: string;
  status: AdminLifecycleExecutionStatus;
  retryable: boolean;
  statusCheckAvailable: boolean;
  requestAttempts: number;
  providerExecutions: number;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  retryAfter?: string;
  lifecycleAction?: string;
  providerRequests?: number;
  reason?: string;
}

export interface AdminLifecycleCommit {
  disposition: "committed" | "idempotent_retry";
  receipt: AdminLifecycleReceipt;
}

export type AdminLifecycleExecutionClaim =
  | { execute: false; receipt: AdminLifecycleReceipt }
  | {
      execute: true;
      requestAttemptId: string;
      receipt: AdminLifecycleReceipt;
    };

interface StoredLifecycleRequest {
  operatorUid: string;
  actionHash: string;
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  auditId: string;
  status: AdminLifecycleExecutionStatus;
  requestAttempts: number;
  providerExecutions: number;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  updatedAt: Timestamp;
  requestAttemptId?: string;
  requestLeaseUntil?: Timestamp;
  nextAttemptAt?: Timestamp;
  observedLifecycleAttemptId?: string;
  observedLifecycleMatchId?: string;
  lifecycleAction?: string;
  providerRequests?: number;
  reason?: string;
}

interface LifecycleOutcome {
  action: string;
  matchId?: string;
  providerRequests: number;
  executionStatus: "skipped_busy" | "completed" | "failed";
  activeExecution?: LifecycleExecutionClaim;
  executionAttemptId?: string;
  reason?: string;
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
    const authorization = authorizationIds(input, challengeToken);
    return this.database.runTransaction(async (transaction) => {
      const references = requestReferences(this.database, input, authorization);
      const teamMatches = this.database
        .collection("matches")
        .where("trackedTeamId", "==", input.trackedTeamId);
      const [challenge, audit, request, match, matches] = await Promise.all([
        transaction.get(references.challenge),
        transaction.get(references.audit),
        transaction.get(references.request),
        transaction.get(references.match),
        transaction.get(teamMatches),
      ]);
      const now = match.readTime.toDate();
      if (challenge.data()?.consumedAt !== undefined) {
        requireDurableAuthorization(
          challenge.data(),
          audit.data(),
          request.data(),
          input,
          authorization,
        );
        return {
          disposition: "idempotent_retry" as const,
          receipt: toReceipt(
            storedRequest(request.data()),
            authorization.auditId,
            now,
          ),
        };
      }
      requireFreshChallenge(challenge.data(), input, authorization, now);
      if (!match.exists) {
        throw new AdminLifecycleRejectedError("Match was not found.");
      }
      const target = fromSnapshot<Match>(match);
      validateTarget(input, target, now);
      validateCanonicalSelection(
        input.matchId,
        matches.docs.map((snapshot) => fromSnapshot<Match>(snapshot)),
        now,
      );
      const previousRequest = target.lastLifecycleRequestedAt
        ? Date.parse(target.lastLifecycleRequestedAt)
        : 0;
      if (now.getTime() - previousRequest < REQUEST_INTERVAL_MS) {
        throw new AdminLifecycleRejectedError("Lifecycle request rate limit.");
      }
      const createdAt = Timestamp.fromDate(now);
      const expiresAt = Timestamp.fromMillis(now.getTime() + RETRY_LIFETIME_MS);
      transaction.update(references.match, {
        lastLifecycleRequestedAt: createdAt,
        updatedAt: createdAt,
      });
      transaction.update(references.challenge, {
        consumedAt: createdAt,
        committedAuditId: authorization.auditId,
      });
      transaction.create(references.audit, {
        operatorUid: input.operatorId,
        action: "lifecycle_request_apply",
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: input.externalFixtureId,
        actionHash: authorization.actionHash,
        outcome: "success",
        commitDisposition: "committed",
        createdAt,
      });
      const stored: StoredLifecycleRequest = {
        operatorUid: input.operatorId,
        actionHash: authorization.actionHash,
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: input.externalFixtureId,
        auditId: authorization.auditId,
        status: "requested",
        requestAttempts: 0,
        providerExecutions: 0,
        createdAt,
        expiresAt,
        updatedAt: createdAt,
      };
      transaction.create(references.request, stored);
      return {
        disposition: "committed" as const,
        receipt: toReceipt(stored, authorization.auditId, now),
      };
    });
  }

  async claimExecution(
    input: AdminLifecycleInput,
    challengeToken: string | undefined,
  ): Promise<AdminLifecycleExecutionClaim> {
    const authorization = authorizationIds(input, challengeToken);
    return this.database.runTransaction(async (transaction) => {
      const references = requestReferences(this.database, input, authorization);
      const teamMatches = this.database
        .collection("matches")
        .where("trackedTeamId", "==", input.trackedTeamId);
      const metadataReference = this.database.doc(
        `footballSyncMetadata/${input.trackedTeamId}`,
      );
      const [challenge, audit, request, match, matches, metadata] =
        await Promise.all([
          transaction.get(references.challenge),
          transaction.get(references.audit),
          transaction.get(references.request),
          transaction.get(references.match),
          transaction.get(teamMatches),
          transaction.get(metadataReference),
        ]);
      const now = request.readTime.toDate();
      requireDurableAuthorization(
        challenge.data(),
        audit.data(),
        request.data(),
        input,
        authorization,
      );
      const original = storedRequest(request.data());
      let stored = original;
      stored = reconcileRequest(
        stored,
        fromSnapshotOrUndefined<Match>(match),
        metadata.data(),
        now,
      );
      const terminal = terminalMatchStatus(
        fromSnapshotOrUndefined<Match>(match),
        now,
      );
      if (terminal) stored = terminalUpdate(stored, terminal, now);
      if (stored !== original) {
        transaction.set(references.request, withoutUndefined(stored));
      }
      if (isTerminal(stored.status) || !canRetry(stored, now)) {
        return {
          execute: false as const,
          receipt: toReceipt(stored, authorization.auditId, now),
        };
      }
      if (
        stored.status === "running" &&
        timestampMillis(stored.requestLeaseUntil) > now.getTime()
      ) {
        return {
          execute: false as const,
          receipt: toReceipt(stored, authorization.auditId, now),
        };
      }
      if (timestampMillis(stored.nextAttemptAt) > now.getTime()) {
        return {
          execute: false as const,
          receipt: toReceipt(stored, authorization.auditId, now),
        };
      }
      if (!match.exists)
        throw new AdminLifecycleRejectedError("Match was not found.");
      const target = fromSnapshot<Match>(match);
      validateTarget(input, target, now);
      validateCanonicalSelection(
        input.matchId,
        matches.docs.map((snapshot) => fromSnapshot<Match>(snapshot)),
        now,
      );
      const requestAttemptId = randomUUID();
      const updated: StoredLifecycleRequest = {
        ...stored,
        status: "running",
        requestAttempts: stored.requestAttempts + 1,
        requestAttemptId,
        requestLeaseUntil: Timestamp.fromMillis(
          now.getTime() + REQUEST_LEASE_MS,
        ),
        nextAttemptAt: undefined,
        observedLifecycleAttemptId: requestAttemptId,
        observedLifecycleMatchId: undefined,
        lifecycleAction: undefined,
        providerRequests: undefined,
        reason: undefined,
        updatedAt: Timestamp.fromDate(now),
      };
      transaction.set(references.request, withoutUndefined(updated));
      return {
        execute: true as const,
        requestAttemptId,
        receipt: toReceipt(updated, authorization.auditId, now),
      };
    });
  }

  async recordExecutionOutcome(
    input: AdminLifecycleInput,
    challengeToken: string | undefined,
    requestAttemptId: string,
    outcome: LifecycleOutcome,
  ): Promise<AdminLifecycleReceipt> {
    const authorization = authorizationIds(input, challengeToken);
    return this.database.runTransaction(async (transaction) => {
      const references = requestReferences(this.database, input, authorization);
      const [challenge, audit, request, match] = await Promise.all([
        transaction.get(references.challenge),
        transaction.get(references.audit),
        transaction.get(references.request),
        transaction.get(references.match),
      ]);
      const now = request.readTime.toDate();
      requireDurableAuthorization(
        challenge.data(),
        audit.data(),
        request.data(),
        input,
        authorization,
      );
      const stored = storedRequest(request.data());
      if (
        stored.requestAttemptId !== requestAttemptId ||
        stored.status !== "running"
      ) {
        return toReceipt(stored, authorization.auditId, now);
      }
      const matchValue = fromSnapshotOrUndefined<Match>(match);
      const terminal = terminalMatchStatus(matchValue, now);
      let updated: StoredLifecycleRequest;
      if (terminal) {
        updated = terminalUpdate(stored, terminal, now);
      } else if (outcome.executionStatus === "skipped_busy") {
        const active = outcome.activeExecution;
        updated = {
          ...stored,
          status: "skipped_busy",
          requestLeaseUntil: undefined,
          nextAttemptAt: Timestamp.fromMillis(now.getTime() + BUSY_BACKOFF_MS),
          observedLifecycleAttemptId:
            active?.status === "busy" ? active.attemptId : undefined,
          observedLifecycleMatchId:
            active?.status === "busy" ? active.matchId : undefined,
          lifecycleAction: outcome.action,
          providerRequests: outcome.providerRequests,
          reason: "execution_in_progress",
          updatedAt: Timestamp.fromDate(now),
        };
      } else {
        const failed =
          outcome.executionStatus === "failed" ||
          outcome.action === "retryable_error" ||
          outcome.matchId !== input.matchId;
        updated = {
          ...stored,
          status: failed ? "failed" : "completed",
          providerExecutions: stored.providerExecutions + 1,
          requestLeaseUntil: undefined,
          nextAttemptAt: failed
            ? Timestamp.fromMillis(now.getTime() + FAILURE_BACKOFF_MS)
            : undefined,
          lifecycleAction: outcome.action,
          providerRequests: outcome.providerRequests,
          reason: failed
            ? outcome.matchId && outcome.matchId !== input.matchId
              ? "target_changed"
              : "transient_failure"
            : outcome.action === "preparing_rating"
              ? "readiness_incomplete"
              : undefined,
          updatedAt: Timestamp.fromDate(now),
        };
      }
      transaction.set(references.request, withoutUndefined(updated));
      return toReceipt(updated, authorization.auditId, now);
    });
  }

  async recordExecutionFailure(
    input: AdminLifecycleInput,
    challengeToken: string | undefined,
    requestAttemptId: string,
  ): Promise<AdminLifecycleReceipt> {
    return this.recordExecutionOutcome(
      input,
      challengeToken,
      requestAttemptId,
      {
        action: "retryable_error",
        providerRequests: 0,
        executionStatus: "failed",
      },
    );
  }

  async inspectAuthorized(
    input: AdminLifecycleInput,
    challengeToken: string | undefined,
  ): Promise<AdminLifecycleReceipt> {
    const authorization = authorizationIds(input, challengeToken);
    return this.database.runTransaction(async (transaction) => {
      const references = requestReferences(this.database, input, authorization);
      const metadataReference = this.database.doc(
        `footballSyncMetadata/${input.trackedTeamId}`,
      );
      const [challenge, audit, request, match, metadata] = await Promise.all([
        transaction.get(references.challenge),
        transaction.get(references.audit),
        transaction.get(references.request),
        transaction.get(references.match),
        transaction.get(metadataReference),
      ]);
      const now = request.readTime.toDate();
      requireDurableAuthorization(
        challenge.data(),
        audit.data(),
        request.data(),
        input,
        authorization,
      );
      const original = storedRequest(request.data());
      let updated = reconcileRequest(
        original,
        fromSnapshotOrUndefined<Match>(match),
        metadata.data(),
        now,
      );
      const terminal = terminalMatchStatus(
        fromSnapshotOrUndefined<Match>(match),
        now,
      );
      if (terminal) updated = terminalUpdate(updated, terminal, now);
      if (updated !== original) {
        transaction.set(references.request, withoutUndefined(updated));
      }
      return toReceipt(updated, authorization.auditId, now);
    });
  }
}

function authorizationIds(
  input: AdminLifecycleInput,
  challengeToken: string | undefined,
) {
  if (!challengeToken || challengeToken.length > 256) {
    throw new AdminLifecycleRejectedError("Admin action challenge is invalid.");
  }
  const challengeId = adminChallengeDocumentId(challengeToken);
  return {
    challengeId,
    auditId: adminLifecycleAuditId(challengeId),
    actionHash: hashAdminLifecycleAction(input),
  };
}

function requestReferences(
  database: Firestore,
  input: AdminLifecycleInput,
  authorization: ReturnType<typeof authorizationIds>,
) {
  return {
    challenge: database.doc(
      `adminActionChallenges/${authorization.challengeId}`,
    ),
    audit: database.doc(`adminAudit/${authorization.auditId}`),
    request: database.doc(`adminLifecycleRequests/${authorization.auditId}`),
    match: database.doc(`matches/${input.matchId}`),
  };
}

function requireFreshChallenge(
  challenge: Record<string, unknown> | undefined,
  input: AdminLifecycleInput,
  authorization: ReturnType<typeof authorizationIds>,
  now: Date,
) {
  if (
    challenge?.operatorUid !== input.operatorId ||
    challenge.matchId !== input.matchId ||
    challenge.actionHash !== authorization.actionHash ||
    !(challenge.expiresAt instanceof Timestamp) ||
    challenge.expiresAt.toMillis() <= now.getTime() ||
    challenge.consumedAt !== undefined
  ) {
    throw new AdminLifecycleRejectedError("Admin action challenge is invalid.");
  }
}

function requireDurableAuthorization(
  challenge: Record<string, unknown> | undefined,
  audit: Record<string, unknown> | undefined,
  request: Record<string, unknown> | undefined,
  input: AdminLifecycleInput,
  authorization: ReturnType<typeof authorizationIds>,
) {
  if (
    challenge?.operatorUid !== input.operatorId ||
    challenge.matchId !== input.matchId ||
    challenge.actionHash !== authorization.actionHash ||
    challenge.committedAuditId !== authorization.auditId ||
    !(challenge.consumedAt instanceof Timestamp) ||
    audit?.operatorUid !== input.operatorId ||
    audit.action !== "lifecycle_request_apply" ||
    audit.matchId !== input.matchId ||
    audit.trackedTeamId !== input.trackedTeamId ||
    audit.externalFixtureId !== input.externalFixtureId ||
    audit.actionHash !== authorization.actionHash ||
    audit.outcome !== "success" ||
    request?.operatorUid !== input.operatorId ||
    request.actionHash !== authorization.actionHash ||
    request.auditId !== authorization.auditId ||
    request.matchId !== input.matchId ||
    request.trackedTeamId !== input.trackedTeamId ||
    request.externalFixtureId !== input.externalFixtureId
  ) {
    throw new AdminLifecycleRejectedError("Admin action challenge is invalid.");
  }
}

function reconcileRequest(
  request: StoredLifecycleRequest,
  match: Match | undefined,
  metadata: Record<string, unknown> | undefined,
  now: Date,
): StoredLifecycleRequest {
  const terminal = terminalMatchStatus(match, now);
  if (terminal) return terminalUpdate(request, terminal, now);
  if (isTerminal(request.status)) return request;
  const observedAttempt = request.observedLifecycleAttemptId;
  const activeAttempt = metadata?.lifecycleAttemptId;
  const lastAttempt = metadata?.lastLifecycleAttemptId;
  const matchingMatch =
    metadata?.lifecycleMatchId === request.matchId ||
    metadata?.lastLifecycleMatchId === request.matchId;
  if (observedAttempt && lastAttempt === observedAttempt && matchingMatch) {
    const completedOwnExecution =
      request.status === "running" &&
      request.requestAttemptId === observedAttempt;
    return {
      ...request,
      status:
        metadata?.lastLifecycleAction === "retryable_error"
          ? "failed"
          : "completed",
      lifecycleAction:
        typeof metadata.lastLifecycleAction === "string"
          ? metadata.lastLifecycleAction
          : request.lifecycleAction,
      providerRequests:
        typeof metadata.lastLifecycleProviderRequests === "number"
          ? metadata.lastLifecycleProviderRequests
          : request.providerRequests,
      providerExecutions: completedOwnExecution
        ? request.providerExecutions + 1
        : request.providerExecutions,
      nextAttemptAt:
        metadata?.lastLifecycleAction === "retryable_error"
          ? Timestamp.fromMillis(now.getTime() + FAILURE_BACKOFF_MS)
          : undefined,
      reason:
        metadata?.lastLifecycleAction === "retryable_error"
          ? "transient_failure"
          : request.reason,
      requestLeaseUntil: undefined,
      updatedAt: Timestamp.fromDate(now),
    };
  }
  if (
    request.status === "running" &&
    observedAttempt === activeAttempt &&
    timestampMillis(metadata?.lifecycleLeaseUntil) > now.getTime()
  ) {
    return request;
  }
  if (
    request.status === "skipped_busy" &&
    observedAttempt === activeAttempt &&
    timestampMillis(metadata?.lifecycleLeaseUntil) > now.getTime()
  ) {
    return request;
  }
  if (
    (request.status === "running" || request.status === "skipped_busy") &&
    timestampMillis(request.requestLeaseUntil) <= now.getTime()
  ) {
    return {
      ...request,
      status: "failed",
      requestLeaseUntil: undefined,
      nextAttemptAt: Timestamp.fromDate(now),
      reason: "execution_unconfirmed",
      updatedAt: Timestamp.fromDate(now),
    };
  }
  return request;
}

function terminalMatchStatus(
  match: Match | undefined,
  now: Date,
): "voting_open" | "completed" | undefined {
  if (!match) return undefined;
  if (
    match.ratingState === "rating_ready" &&
    match.votingOpensAt &&
    match.votingClosesAt &&
    Date.parse(match.votingOpensAt) <= now.getTime() &&
    Date.parse(match.votingClosesAt) > now.getTime()
  ) {
    return "voting_open";
  }
  if (
    match.ratingState === "rating_ready" ||
    match.ratingState === "rating_closed"
  ) {
    return "completed";
  }
  return undefined;
}

function terminalUpdate(
  request: StoredLifecycleRequest,
  status: "voting_open" | "completed",
  now: Date,
): StoredLifecycleRequest {
  if (request.status === status) return request;
  return {
    ...request,
    status,
    requestLeaseUntil: undefined,
    nextAttemptAt: undefined,
    reason: status === "voting_open" ? "voting_window_active" : request.reason,
    updatedAt: Timestamp.fromDate(now),
  };
}

function canRetry(request: StoredLifecycleRequest, now: Date): boolean {
  return (
    request.expiresAt.toMillis() > now.getTime() &&
    request.requestAttempts < MAX_REQUEST_ATTEMPTS &&
    request.providerExecutions < MAX_PROVIDER_EXECUTIONS
  );
}

function isTerminal(status: AdminLifecycleExecutionStatus) {
  return status === "completed" || status === "voting_open";
}

function toReceipt(
  request: StoredLifecycleRequest,
  auditId: string,
  now: Date,
): AdminLifecycleReceipt {
  return {
    auditId,
    status: request.status,
    retryable: !isTerminal(request.status) && canRetry(request, now),
    statusCheckAvailable:
      !isTerminal(request.status) &&
      request.expiresAt.toMillis() > now.getTime(),
    requestAttempts: request.requestAttempts,
    providerExecutions: request.providerExecutions,
    createdAt: request.createdAt.toDate().toISOString(),
    expiresAt: request.expiresAt.toDate().toISOString(),
    updatedAt: request.updatedAt.toDate().toISOString(),
    ...(request.nextAttemptAt
      ? { retryAfter: request.nextAttemptAt.toDate().toISOString() }
      : {}),
    ...(request.lifecycleAction
      ? { lifecycleAction: request.lifecycleAction }
      : {}),
    ...(request.providerRequests === undefined
      ? {}
      : { providerRequests: request.providerRequests }),
    ...(request.reason ? { reason: request.reason } : {}),
  };
}

function storedRequest(
  value: Record<string, unknown> | undefined,
): StoredLifecycleRequest {
  const validStatus = [
    "requested",
    "running",
    "skipped_busy",
    "completed",
    "failed",
    "voting_open",
  ].includes(String(value?.status));
  if (
    !value ||
    typeof value.operatorUid !== "string" ||
    typeof value.actionHash !== "string" ||
    typeof value.matchId !== "string" ||
    typeof value.trackedTeamId !== "string" ||
    typeof value.externalFixtureId !== "string" ||
    typeof value.auditId !== "string" ||
    !validStatus ||
    typeof value.requestAttempts !== "number" ||
    !Number.isInteger(value.requestAttempts) ||
    typeof value.providerExecutions !== "number" ||
    !Number.isInteger(value.providerExecutions) ||
    !(value.createdAt instanceof Timestamp) ||
    !(value.expiresAt instanceof Timestamp) ||
    !(value.updatedAt instanceof Timestamp)
  ) {
    throw new AdminLifecycleRejectedError("Admin action challenge is invalid.");
  }
  return value as unknown as StoredLifecycleRequest;
}

function withoutUndefined<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  );
}

function timestampMillis(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : 0;
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

function fromSnapshotOrUndefined<T>(snapshot: {
  exists: boolean;
  id: string;
  data(): Record<string, unknown> | undefined;
}): T | undefined {
  return snapshot.exists ? fromSnapshot<T>(snapshot) : undefined;
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
