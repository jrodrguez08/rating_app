import { isDeepStrictEqual } from "node:util";

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

import {
  buildMatchArchive,
  type MatchArchive,
} from "@/application/match-archive";
import {
  buildPlayerCatalog,
  type PlayerCatalog,
} from "@/application/player-history";
import {
  membershipFromParticipant,
  membershipFromPlayer,
  mergeTeamPlayerMembership,
} from "@/application/team-player-membership";
import { validateBallotRatings } from "@/domain/ballot-validation";
import { preserveMonotonicMatchStatus } from "@/domain/match-status";
import { aggregateMatchResult } from "@/domain/result-aggregation";
import {
  compareVoteWithResult,
  type VoteComparison,
} from "@/domain/vote-comparison";
import type {
  Ballot,
  Coach,
  CoachAssignment,
  BallotContext,
  Competition,
  FootballSyncMetadata,
  Match,
  MatchResult,
  MatchParticipant,
  Player,
  PlayerProviderAlias,
  Season,
  StandingsSnapshot,
  Team,
  TeamPlayerMembership,
  VerifiedCoachAssignment,
  VerifiedLineupReconciliation,
  VerifiedLineupSnapshot,
} from "@/domain/models";
import type {
  FootballSyncStore,
  LifecycleExecutionClaim,
  MatchLifecycleStore,
  ProviderMatchContext,
  StandingsSyncStore,
  StandingsSyncTarget,
  SyncWriteCounts,
  VotingWindowNotificationClaim,
  VotingWindowNotificationStore,
} from "@/domain/ports";
import {
  canonicalPlayerIdMap,
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import { discoverTeamPlayers } from "@/lib/firebase/team-player-discovery";
import { selectDurableVerifiedLineupReconciliation } from "@/domain/verified-lineup-reconciliation";
import {
  getEffectiveVotingWindow,
  getVotingWindowState,
} from "@/domain/voting-window";
import {
  adminChallengeDocumentId,
  adminCoachAssignmentAuditId,
  hashAdminCoachAction,
} from "@/lib/server/admin-coach-action";
import { readFirebaseAdminRuntimeConfig } from "@/lib/server/environment";

const TIMESTAMP_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "kickoffAt",
  "lastProviderSyncAt",
  "lineupSnapshotAt",
  "lineupCaptureLastAttemptAt",
  "participantSyncedAt",
  "finishedObservedAt",
  "lastLifecycleRequestedAt",
  "ratingReadyAt",
  "votingOpensAt",
  "votingClosesAt",
  "votingReopenedAt",
  "effectiveVotingOpensAt",
  "effectiveVotingClosesAt",
  "votingClosedEarlyAt",
  "votingOpenNotificationFirstAttemptAt",
  "votingOpenNotificationAttemptedAt",
  "votingOpenNotificationLeaseUntil",
  "votingOpenNotificationSentAt",
  "verifiedAt",
  "archivedAt",
  "windowOpensAt",
  "windowClosesAt",
  "windowReopenedAt",
  "windowClosedEarlyAt",
  "generatedAt",
  "lastFixtureDiscoveryAt",
  "lifecycleLeaseUntil",
  "lastLifecycleStartedAt",
  "lastLifecycleCompletedAt",
  "providerSyncedAt",
]);

export function getServerFirestore(): Firestore {
  const config = readFirebaseAdminRuntimeConfig();
  if (config.emulator) {
    process.env.FIRESTORE_EMULATOR_HOST = config.firestoreEmulatorHost;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = config.authEmulatorHost;
  }
  if (!getApps().some((app) => app.name === "[DEFAULT]")) {
    initializeApp({
      projectId: config.projectId,
      credential: config.emulator
        ? applicationDefault()
        : cert({
            projectId: config.projectId,
            clientEmail: config.clientEmail!,
            privateKey: config.privateKey!,
          }),
    });
  }
  return getFirestore();
}

export function getServerAuth(): Auth {
  getServerFirestore();
  return getAuth();
}

export type BallotPageState =
  | { state: "active"; context: BallotContext }
  | { state: "not_open" | "closed" | "unavailable" };

export type BallotSubmissionResult =
  | { status: "created" }
  | {
      status:
        | "already_submitted"
        | "not_open"
        | "closed"
        | "data_unavailable"
        | "invalid_ballot";
    };

export type ResultPageState =
  | { state: "ready"; match: Match; result: MatchResult }
  | { state: "locked" | "preparing" | "unavailable"; match?: Match };

export class AdminResultService {
  constructor(private readonly database = getServerFirestore()) {}

  async getPageState(
    matchId: string,
    now = new Date(),
  ): Promise<ResultPageState> {
    const matchSnapshot = await this.database.doc(`matches/${matchId}`).get();
    if (!matchSnapshot.exists) return { state: "unavailable" };
    const match = fromDocument<Match>(matchSnapshot);
    if (match.ratingState === "rating_closed") {
      const resultSnapshot = await this.database
        .doc(`matches/${matchId}/results/summary`)
        .get();
      if (!resultSnapshot.exists) return { state: "preparing", match };
      const result = fromDocument<MatchResult>(resultSnapshot);
      if (!isCompatibleCurrentResult(match, result)) {
        return { state: "preparing", match };
      }
      return { state: "ready", match, result };
    }
    const window = getEffectiveVotingWindow(match);
    if (window === null || now < new Date(window.closesAt)) {
      return { state: "locked", match };
    }
    return { state: "preparing", match };
  }

  async getVoteComparison(
    matchId: string,
    voterId: string,
    now = new Date(),
  ): Promise<
    | { status: "locked" | "no_ballot" | "unavailable" }
    | { status: "ready"; comparison: VoteComparison }
  > {
    const page = await this.getPageState(matchId, now);
    if (page.state !== "ready") return { status: "locked" };

    const ballotSnapshot = await this.database
      .doc(`matches/${matchId}/ballots/${voterId}`)
      .get();
    if (!ballotSnapshot.exists) return { status: "no_ballot" };
    const ballot = fromDocument<Ballot>(ballotSnapshot);
    if (ballot.voterId !== voterId) return { status: "unavailable" };

    const participantSnapshot = await this.database
      .collection(`matches/${matchId}/participants`)
      .get();
    const aliasIds = [
      ...new Set(
        participantSnapshot.docs
          .map((snapshot) => fromDocument<MatchParticipant>(snapshot))
          .filter(
            (participant) =>
              participant.externalProvider !== undefined &&
              participant.externalProviderPlayerId !== undefined,
          )
          .map((participant) =>
            playerProviderAliasId(
              participant.externalProvider!,
              participant.externalProviderPlayerId!,
            ),
          ),
      ),
    ];
    const aliasSnapshots =
      aliasIds.length === 0
        ? []
        : await this.database.getAll(
            ...aliasIds.map((id) =>
              this.database.doc(`playerProviderAliases/${id}`),
            ),
          );
    const canonicalIds = canonicalPlayerIdMap(
      aliasSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => fromDocument<PlayerProviderAlias>(snapshot)),
    );
    const comparison = compareVoteWithResult(ballot, page.result, canonicalIds);
    return comparison === null
      ? { status: "unavailable" }
      : { status: "ready", comparison };
  }
}

export class AdminMatchArchiveService {
  constructor(private readonly database = getServerFirestore()) {}

  async list(teamId: string, now = new Date()): Promise<MatchArchive> {
    const matches = await new AdminFootballSyncStore(this.database).listMatches(
      teamId,
    );
    if (matches.length === 0) return buildMatchArchive([], now);
    const competitionIds = [
      ...new Set(matches.map((match) => match.competitionId)),
    ];
    const [competitions, results] = await Promise.all([
      this.database.getAll(
        ...competitionIds.map((id) => this.database.doc(`competitions/${id}`)),
      ),
      this.database.getAll(
        ...matches.map((match) =>
          this.database.doc(`matches/${match.id}/results/summary`),
        ),
      ),
    ]);
    const competitionNames = new Map(
      competitions
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => [
          snapshot.id,
          fromDocument<Competition>(snapshot).name,
        ]),
    );
    const resultIds = new Set(
      results
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => snapshot.ref.parent.parent?.id),
    );
    return buildMatchArchive(
      matches.map((match) => ({
        match,
        ...(competitionNames.get(match.competitionId) === undefined
          ? {}
          : { competitionName: competitionNames.get(match.competitionId) }),
        hasResults: resultIds.has(match.id),
      })),
      now,
    );
  }

  async get(matchId: string, teamId: string) {
    const matchSnapshot = await this.database.doc(`matches/${matchId}`).get();
    if (!matchSnapshot.exists) return null;
    const match = fromDocument<Match>(matchSnapshot);
    if (match.trackedTeamId !== teamId) return null;
    const [competition, result] = await Promise.all([
      this.database.doc(`competitions/${match.competitionId}`).get(),
      this.database.doc(`matches/${match.id}/results/summary`).get(),
    ]);
    return {
      match,
      ...(competition.exists
        ? { competitionName: fromDocument<Competition>(competition).name }
        : {}),
      hasResults: result.exists,
    };
  }
}

export class AdminPlayerHistoryService {
  constructor(private readonly database = getServerFirestore()) {}

  async list(teamId: string): Promise<PlayerCatalog> {
    const store = new AdminFootballSyncStore(this.database);
    const [team, discovery] = await Promise.all([
      store.getTeam(teamId),
      discoverTeamPlayers(this.database, teamId),
    ]);
    if (team.externalProviderId === undefined)
      throw new Error(`Tracked Team ${teamId} has no provider mapping.`);
    const matches = discovery.matches.sort(
      (left, right) =>
        new Date(right.kickoffAt).getTime() -
          new Date(left.kickoffAt).getTime() || left.id.localeCompare(right.id),
    );
    const resultSnapshots = [];
    for (let offset = 0; offset < matches.length; offset += 100) {
      resultSnapshots.push(
        ...(await this.database.getAll(
          ...matches
            .slice(offset, offset + 100)
            .map((match) =>
              this.database.doc(`matches/${match.id}/results/summary`),
            ),
        )),
      );
    }
    const results = resultSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => fromDocument<MatchResult>(snapshot));
    return buildPlayerCatalog({
      identities: discovery.players.map(({ player }) => ({
        id: player.id,
        name: player.displayName,
        ...(player.position === undefined ? {} : { position: player.position }),
        ...(player.photoUrl === undefined ? {} : { photoUrl: player.photoUrl }),
      })),
      matches,
      results,
      trackedTeamExternalProviderId: team.externalProviderId,
      canonicalPlayerIds: discovery.canonicalPlayerIds,
    });
  }

  async get(playerId: string, teamId: string) {
    const [catalog, canonicalPlayerId] = await Promise.all([
      this.list(teamId),
      this.resolveCanonicalPlayerId(playerId),
    ]);
    return catalog.players.find(
      (player) => player.playerId === canonicalPlayerId,
    );
  }

  private async resolveCanonicalPlayerId(playerId: string): Promise<string> {
    const playerSnapshot = await this.database.doc(`players/${playerId}`).get();
    if (!playerSnapshot.exists) return playerId;
    const player = fromDocument<Player>(playerSnapshot);
    if (
      player.externalProvider === undefined ||
      player.externalProviderId === undefined
    ) {
      return playerId;
    }
    const aliasSnapshot = await this.database
      .doc(
        `playerProviderAliases/${playerProviderAliasId(
          player.externalProvider,
          player.externalProviderId,
        )}`,
      )
      .get();
    return aliasSnapshot.exists
      ? fromDocument<PlayerProviderAlias>(aliasSnapshot).canonicalPlayerId
      : playerId;
  }
}

export class AdminStandingsService {
  constructor(private readonly database = getServerFirestore()) {}

  async get(trackedTeamId: string): Promise<{
    snapshot: StandingsSnapshot;
    trackedTeamExternalProviderId: string;
  } | null> {
    const store = new AdminFootballSyncStore(this.database);
    const [team, snapshot] = await Promise.all([
      store.getTeam(trackedTeamId),
      store.getStandingsSnapshot(trackedTeamId),
    ]);
    if (snapshot === null || team.externalProviderId === undefined) return null;
    return {
      snapshot,
      trackedTeamExternalProviderId: team.externalProviderId,
    };
  }
}

export class AdminBallotService {
  constructor(private readonly database = getServerFirestore()) {}

  async getPageState(
    matchId: string,
    now = new Date(),
  ): Promise<BallotPageState> {
    const matchSnapshot = await this.database.doc(`matches/${matchId}`).get();
    if (!matchSnapshot.exists) return { state: "unavailable" };
    const match = fromDocument<Match>(matchSnapshot);
    const windowState = getVotingWindowState(match, now);
    if (windowState !== "active") return { state: windowState };

    const [participantSnapshot, coachSnapshot] = await Promise.all([
      this.database.collection(`matches/${matchId}/participants`).get(),
      this.database.doc(`matches/${matchId}/coachAssignments/head-coach`).get(),
    ]);
    const players = participantSnapshot.docs
      .map((document) =>
        fromDocument<MatchParticipant & { id: string }>(document),
      )
      .filter(
        (participant) =>
          participant.teamId === match.trackedTeamId &&
          participant.participated,
      )
      .sort(compareParticipants)
      .map((participant) => ({
        id: participant.playerId,
        name: participant.playerName,
        ...(participant.position === undefined
          ? {}
          : { position: participant.position as Player["position"] }),
        substitute: participant.squadRole === "substitute",
      }));
    const coach = coachSnapshot.exists
      ? fromDocument<CoachAssignment & { id: string }>(coachSnapshot)
      : null;
    if (
      players.length === 0 ||
      coach === null ||
      coach.teamId !== match.trackedTeamId
    ) {
      return { state: "unavailable" };
    }
    return {
      state: "active",
      context: {
        matchId: match.id,
        teamId: match.trackedTeamId,
        homeTeamName: match.homeTeam.name,
        awayTeamName: match.awayTeam.name,
        score: match.score,
        votingClosesAt: getEffectiveVotingWindow(match)!.closesAt,
        players,
        coach: { id: coach.coachId, name: coach.coachName },
      },
    };
  }

  async hasSubmitted(matchId: string, voterId: string): Promise<boolean> {
    return (
      await this.database.doc(`matches/${matchId}/ballots/${voterId}`).get()
    ).exists;
  }

  async submit(
    matchId: string,
    voterId: string,
    input: unknown,
    now = new Date(),
  ): Promise<BallotSubmissionResult> {
    return this.database.runTransaction(async (transaction) => {
      const matchReference = this.database.doc(`matches/${matchId}`);
      const participantQuery = this.database.collection(
        `matches/${matchId}/participants`,
      );
      const coachReference = this.database.doc(
        `matches/${matchId}/coachAssignments/head-coach`,
      );
      const ballotReference = this.database.doc(
        `matches/${matchId}/ballots/${voterId}`,
      );
      const [
        matchSnapshot,
        participantSnapshot,
        coachSnapshot,
        ballotSnapshot,
      ] = await Promise.all([
        transaction.get(matchReference),
        transaction.get(participantQuery),
        transaction.get(coachReference),
        transaction.get(ballotReference),
      ]);
      if (ballotSnapshot.exists) return { status: "already_submitted" };
      if (!matchSnapshot.exists) return { status: "data_unavailable" };
      const match = fromDocument<Match>(matchSnapshot);
      const windowState = getVotingWindowState(match, now);
      if (windowState !== "active") return { status: windowState };

      const eligiblePlayerIds = participantSnapshot.docs
        .map((document) => document.data() as Partial<MatchParticipant>)
        .filter(
          (participant) =>
            participant.teamId === match.trackedTeamId &&
            participant.participated === true,
        )
        .map((participant) => participant.playerId)
        .filter((playerId): playerId is string => typeof playerId === "string");
      const coach = coachSnapshot.data() as
        Partial<CoachAssignment> | undefined;
      if (
        eligiblePlayerIds.length === 0 ||
        coach?.teamId !== match.trackedTeamId ||
        typeof coach.coachId !== "string"
      ) {
        return { status: "data_unavailable" };
      }
      const validation = validateBallotRatings(
        eligiblePlayerIds,
        coach.coachId,
        input,
      );
      if (!validation.valid) return { status: validation.reason };

      transaction.create(ballotReference, {
        matchId,
        voterId,
        teamId: match.trackedTeamId,
        submittedAt: FieldValue.serverTimestamp(),
        playerRatings: validation.ratings.playerRatings,
        coachRating: validation.ratings.coachRating,
      });
      return { status: "created" };
    });
  }
}

export interface VotingWindowPlan {
  operation: "reopen" | "close";
  matchId: string;
  trustedAt: string;
  current: {
    status: Match["status"];
    ratingState: Match["ratingState"];
    ratingReadyAt?: string;
    originalVotingOpensAt?: string;
    originalVotingClosesAt?: string;
    effectiveVotingOpensAt: string;
    effectiveVotingClosesAt: string;
    reopened: boolean;
    votingReopenCount: number;
    resultSummaryExists: boolean;
    resultGeneratedAt?: string;
    ballotCount: number;
  };
  proposed: {
    effectiveVotingOpensAt?: string;
    effectiveVotingClosesAt: string;
    archivePath?: string;
    changes: string[];
    finalizesImmediately: boolean;
  };
}

export class AdminVotingWindowService {
  constructor(private readonly database = getServerFirestore()) {}

  async reopen(
    matchId: string,
    requestedClosesAt: Date,
    apply: boolean,
  ): Promise<VotingWindowPlan> {
    return this.database.runTransaction(async (transaction) => {
      const matchReference = this.database.doc(`matches/${matchId}`);
      const resultReference = this.database.doc(
        `matches/${matchId}/results/summary`,
      );
      const participantQuery = this.database.collection(
        `matches/${matchId}/participants`,
      );
      const coachReference = this.database.doc(
        `matches/${matchId}/coachAssignments/head-coach`,
      );
      const ballotQuery = this.database.collection(
        `matches/${matchId}/ballots`,
      );
      const initial = await Promise.all([
        transaction.get(matchReference),
        transaction.get(resultReference),
        transaction.get(participantQuery),
        transaction.get(coachReference),
        transaction.get(ballotQuery),
      ]);
      const [
        matchSnapshot,
        resultSnapshot,
        participants,
        coachSnapshot,
        ballots,
      ] = initial;
      if (!matchSnapshot.exists) throw new Error("Match was not found.");
      const match = fromDocument<Match>(matchSnapshot);
      const trustedAt = matchSnapshot.readTime.toDate();
      const window = requireAuditableWindow(match);
      if (
        match.status !== "finished" ||
        match.ratingState !== "rating_closed"
      ) {
        throw new Error(
          "Only a finished, closed rating window can be reopened.",
        );
      }
      if (!resultSnapshot.exists) {
        throw new Error("The current finalized result summary is missing.");
      }
      validateReopenCloseTime(requestedClosesAt, trustedAt);
      if (!coachSnapshot.exists)
        throw new Error("Head coach assignment is missing.");
      const coach = fromDocument<CoachAssignment>(coachSnapshot);
      const participantValues = participants.docs.map((document) =>
        fromDocument<MatchParticipant>(document),
      );
      const ballotValues = ballots.docs.map((document) =>
        fromDocument<Ballot>(document),
      );
      const expectedResult = aggregateMatchResult({
        matchId,
        teamId: match.trackedTeamId,
        participants: participantValues,
        coach,
        ballots: ballotValues,
        generatedAt: trustedAt.toISOString(),
      });
      const result = fromDocument<MatchResult>(resultSnapshot);
      requireCanonicalCurrentResult(result, expectedResult);
      const revision = (match.votingReopenCount ?? 0) + 1;
      const archiveId = `reopen-${String(revision).padStart(4, "0")}`;
      const archiveReference = this.database.doc(
        `matches/${matchId}/resultRevisions/${archiveId}`,
      );
      const archiveSnapshot = await transaction.get(archiveReference);
      if (archiveSnapshot.exists) {
        throw new Error("The proposed result revision already exists.");
      }
      const plan = reopenPlan({
        match,
        result,
        ballotCount: ballots.size,
        trustedAt,
        requestedClosesAt,
        archivePath: archiveReference.path,
      });
      if (apply) {
        transaction.create(
          archiveReference,
          toDocument({
            ...result,
            revision,
            archiveReason: "voting_reopened",
            archivedAt: trustedAt.toISOString(),
            windowOpensAt: window.opensAt,
            windowClosesAt: window.closesAt,
            windowReopened: window.reopened,
            ...(match.votingReopenedAt === undefined
              ? {}
              : { windowReopenedAt: match.votingReopenedAt }),
            ...(match.votingClosedEarlyAt === undefined
              ? {}
              : { windowClosedEarlyAt: match.votingClosedEarlyAt }),
          }),
        );
        transaction.delete(resultReference);
        transaction.update(matchReference, {
          ratingState: "rating_ready",
          votingReopenedAt: Timestamp.fromDate(trustedAt),
          votingReopenCount: revision,
          effectiveVotingOpensAt: Timestamp.fromDate(trustedAt),
          effectiveVotingClosesAt: Timestamp.fromDate(requestedClosesAt),
          votingClosedEarlyAt: FieldValue.delete(),
          votingOpenNotificationWindow: revision,
          votingOpenNotificationStatus: "pending",
          votingOpenNotificationAttemptId: FieldValue.delete(),
          votingOpenNotificationFirstAttemptAt: FieldValue.delete(),
          votingOpenNotificationAttemptedAt: FieldValue.delete(),
          votingOpenNotificationLeaseUntil: FieldValue.delete(),
          votingOpenNotificationSentAt: FieldValue.delete(),
          votingOpenNotificationProviderId: FieldValue.delete(),
          updatedAt: Timestamp.fromDate(trustedAt),
        });
      }
      return plan;
    });
  }

  async planClose(matchId: string): Promise<VotingWindowPlan> {
    const matchReference = this.database.doc(`matches/${matchId}`);
    const resultReference = this.database.doc(
      `matches/${matchId}/results/summary`,
    );
    const ballotQuery = this.database.collection(`matches/${matchId}/ballots`);
    return this.database.runTransaction(async (transaction) => {
      const [matchSnapshot, resultSnapshot, ballots] = await Promise.all([
        transaction.get(matchReference),
        transaction.get(resultReference),
        transaction.get(ballotQuery),
      ]);
      if (!matchSnapshot.exists) throw new Error("Match was not found.");
      const match = fromDocument<Match>(matchSnapshot);
      const trustedAt = matchSnapshot.readTime.toDate();
      requireAuditableWindow(match);
      if (
        match.status !== "finished" ||
        getVotingWindowState(match, trustedAt) !== "active"
      ) {
        throw new Error("Only an active finished rating window can be closed.");
      }
      if (resultSnapshot.exists) {
        throw new Error(
          "An active rating window must not have a result summary.",
        );
      }
      return {
        operation: "close",
        matchId,
        trustedAt: trustedAt.toISOString(),
        current: planCurrent(match, ballots.size, false, undefined),
        proposed: {
          effectiveVotingClosesAt: trustedAt.toISOString(),
          changes: [
            `create matches/${matchId}/results/summary`,
            `update matches/${matchId}: ratingState, votingClosedEarlyAt, updatedAt`,
          ],
          finalizesImmediately: true,
        },
      } satisfies VotingWindowPlan;
    });
  }

  async close(matchId: string): Promise<VotingWindowPlan> {
    await this.planClose(matchId);
    const finalizedAt = await new AdminFootballSyncStore(
      this.database,
    ).closeVotingWindowEarly(matchId);
    return {
      ...(await this.closedPlan(matchId, finalizedAt)),
      trustedAt: finalizedAt.toISOString(),
    };
  }

  private async closedPlan(matchId: string, finalizedAt: Date) {
    const [matchSnapshot, resultSnapshot, ballots] = await Promise.all([
      this.database.doc(`matches/${matchId}`).get(),
      this.database.doc(`matches/${matchId}/results/summary`).get(),
      this.database.collection(`matches/${matchId}/ballots`).get(),
    ]);
    const match = fromDocument<Match>(matchSnapshot);
    return {
      operation: "close" as const,
      matchId,
      trustedAt: finalizedAt.toISOString(),
      current: planCurrent(
        match,
        ballots.size,
        resultSnapshot.exists,
        resultSnapshot.exists
          ? fromDocument<MatchResult>(resultSnapshot).generatedAt
          : undefined,
      ),
      proposed: {
        effectiveVotingClosesAt: finalizedAt.toISOString(),
        changes: [
          `created matches/${matchId}/results/summary`,
          `updated matches/${matchId}: ratingState, votingClosedEarlyAt, updatedAt`,
        ],
        finalizesImmediately: true,
      },
    } satisfies VotingWindowPlan;
  }
}

export interface VerifiedCoachAssignmentPlan {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  current: {
    coachExists: boolean;
    verifiedAssignmentExists: boolean;
    headCoachId?: string;
    headCoachProvenance?: CoachAssignment["provenance"];
  };
  coachId: string;
  coachName: string;
  coachCreated: boolean;
  assignmentCreated: boolean;
  verificationSource: string;
  verificationReason: string;
}

export interface VerifiedCoachAssignmentInput {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  coachId: string;
  coachName: string;
  externalProviderCoachId?: string;
  verificationSource: string;
  verificationReason: string;
  operatorId: string;
}

export interface AuthorizedVerifiedCoachAssignmentResult {
  plan: VerifiedCoachAssignmentPlan;
  auditId: string;
  disposition: "committed" | "idempotent_retry";
}

export class AdminVerifiedCoachAssignmentRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminVerifiedCoachAssignmentRejectedError";
  }
}

export class AdminVerifiedCoachAssignmentCommitError extends Error {
  constructor() {
    super("Verified coach assignment transaction failed before commit.");
    this.name = "AdminVerifiedCoachAssignmentCommitError";
  }
}

export class AdminVerifiedCoachService {
  constructor(private readonly database = getServerFirestore()) {}

  async assign(
    input: VerifiedCoachAssignmentInput,
    apply: boolean,
  ): Promise<VerifiedCoachAssignmentPlan> {
    return (await this.execute(input, apply)).plan;
  }

  async assignAuthorized(
    input: VerifiedCoachAssignmentInput,
    challengeToken: string | undefined,
  ): Promise<AuthorizedVerifiedCoachAssignmentResult> {
    if (!challengeToken || !/^[A-Za-z0-9_-]{40,64}$/.test(challengeToken)) {
      throw new AdminVerifiedCoachAssignmentRejectedError(
        "Admin action challenge is invalid.",
      );
    }
    const challengeId = adminChallengeDocumentId(challengeToken);
    try {
      const result = await this.execute(input, true, challengeId);
      if (!result.auditId || !result.disposition) {
        throw new Error("Atomic coach assignment did not return an audit.");
      }
      return {
        plan: result.plan,
        auditId: result.auditId,
        disposition: result.disposition,
      };
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new AdminVerifiedCoachAssignmentCommitError();
      }
      throw error;
    }
  }

  private async execute(
    input: VerifiedCoachAssignmentInput,
    apply: boolean,
    challengeId?: string,
  ): Promise<{
    plan: VerifiedCoachAssignmentPlan;
    auditId?: string;
    disposition?: "committed" | "idempotent_retry";
  }> {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.matchId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.trackedTeamId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.externalFixtureId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.coachId) ||
      input.coachName.trim() === "" ||
      input.coachName.length > 120 ||
      !validVerificationSource(input.verificationSource) ||
      input.verificationReason.trim().length < 10 ||
      input.verificationReason.length > 500 ||
      !/^[A-Za-z0-9_.@-]{1,128}$/.test(input.operatorId) ||
      (input.externalProviderCoachId !== undefined &&
        !/^\d+$/.test(input.externalProviderCoachId))
    ) {
      throw new AdminVerifiedCoachAssignmentRejectedError(
        "Verified coach assignment input is invalid.",
      );
    }
    return this.database.runTransaction(async (transaction) => {
      const matchReference = this.database.doc(`matches/${input.matchId}`);
      const coachReference = this.database.doc(`coaches/${input.coachId}`);
      const verifiedReference = this.database.doc(
        `matches/${input.matchId}/verifiedCoachAssignments/head-coach`,
      );
      const assignmentReference = this.database.doc(
        `matches/${input.matchId}/coachAssignments/head-coach`,
      );
      const resultReference = this.database.doc(
        `matches/${input.matchId}/results/summary`,
      );
      const ballotQuery = this.database.collection(
        `matches/${input.matchId}/ballots`,
      );
      const revisionQuery = this.database.collection(
        `matches/${input.matchId}/resultRevisions`,
      );
      const challengeReference = challengeId
        ? this.database.doc(`adminActionChallenges/${challengeId}`)
        : undefined;
      const auditId = challengeId
        ? adminCoachAssignmentAuditId(challengeId)
        : undefined;
      const auditReference = auditId
        ? this.database.doc(`adminAudit/${auditId}`)
        : undefined;
      const actionHash = challengeReference
        ? hashAdminCoachAction(input)
        : undefined;
      if (challengeReference && auditReference && auditId && actionHash) {
        const challengeSnapshot = await transaction.get(challengeReference);
        const challenge = challengeSnapshot.data();
        if (
          !challengeSnapshot.exists ||
          challenge?.operatorUid !== input.operatorId ||
          challenge.matchId !== input.matchId ||
          challenge.actionHash !== actionHash ||
          !(challenge.expiresAt instanceof Timestamp)
        ) {
          throw new AdminVerifiedCoachAssignmentRejectedError(
            "Admin action challenge is invalid.",
          );
        }
        if (challenge.consumedAt !== undefined) {
          if (
            !(challenge.consumedAt instanceof Timestamp) ||
            challenge.committedAuditId !== auditId
          ) {
            throw new AdminVerifiedCoachAssignmentRejectedError(
              "Admin action challenge is invalid.",
            );
          }
          const auditSnapshot = await transaction.get(auditReference);
          const audit = auditSnapshot.data();
          if (
            !auditSnapshot.exists ||
            audit?.operatorUid !== input.operatorId ||
            audit.action !== "coach_assignment_apply" ||
            audit.matchId !== input.matchId ||
            audit.trackedTeamId !== input.trackedTeamId ||
            audit.externalFixtureId !== input.externalFixtureId ||
            audit.coachId !== input.coachId ||
            audit.coachName !== input.coachName ||
            audit.externalProviderCoachId !==
              (input.externalProviderCoachId ?? null) ||
            audit.evidenceReference !== input.verificationSource ||
            audit.verificationReason !== input.verificationReason ||
            audit.actionHash !== actionHash ||
            audit.outcome !== "success" ||
            audit.commitDisposition !== "committed" ||
            !(audit.createdAt instanceof Timestamp) ||
            typeof audit.coachExistedBefore !== "boolean" ||
            typeof audit.verifiedAssignmentExistedBefore !== "boolean" ||
            typeof audit.coachCreated !== "boolean" ||
            typeof audit.assignmentCreated !== "boolean" ||
            (audit.headCoachId !== undefined &&
              typeof audit.headCoachId !== "string") ||
            (audit.headCoachProvenance !== undefined &&
              audit.headCoachProvenance !== "provider" &&
              audit.headCoachProvenance !== "operator_verified")
          ) {
            throw new AdminVerifiedCoachAssignmentRejectedError(
              "Committed admin action audit is invalid.",
            );
          }
          return {
            plan: {
              matchId: input.matchId,
              trackedTeamId: input.trackedTeamId,
              externalFixtureId: input.externalFixtureId,
              current: {
                coachExists: audit.coachExistedBefore,
                verifiedAssignmentExists: audit.verifiedAssignmentExistedBefore,
                ...(audit.headCoachId
                  ? {
                      headCoachId: audit.headCoachId,
                      ...(audit.headCoachProvenance
                        ? {
                            headCoachProvenance:
                              audit.headCoachProvenance as NonNullable<
                                CoachAssignment["provenance"]
                              >,
                          }
                        : {}),
                    }
                  : {}),
              },
              coachId: input.coachId,
              coachName: input.coachName,
              coachCreated: audit.coachCreated,
              assignmentCreated: audit.assignmentCreated,
              verificationSource: input.verificationSource,
              verificationReason: input.verificationReason,
            },
            auditId,
            disposition: "idempotent_retry" as const,
          };
        }
        if (
          challenge.committedAuditId !== undefined ||
          challenge.expiresAt.toMillis() <=
            challengeSnapshot.readTime.toMillis()
        ) {
          throw new AdminVerifiedCoachAssignmentRejectedError(
            "Admin action challenge is invalid.",
          );
        }
      }
      const matchSnapshot = await transaction.get(matchReference);
      const coachSnapshot = await transaction.get(coachReference);
      const verifiedSnapshot = await transaction.get(verifiedReference);
      const assignmentSnapshot = await transaction.get(assignmentReference);
      const resultSnapshot = await transaction.get(resultReference);
      const ballots = await transaction.get(ballotQuery);
      const revisions = await transaction.get(revisionQuery);
      if (!matchSnapshot.exists) {
        throw new AdminVerifiedCoachAssignmentRejectedError(
          "Match was not found.",
        );
      }
      const match = fromDocument<Match>(matchSnapshot);
      if (
        match.trackedTeamId !== input.trackedTeamId ||
        match.externalProviderFixtureId !== input.externalFixtureId
      ) {
        throw new AdminVerifiedCoachAssignmentRejectedError(
          "Match Team or fixture confirmation does not match.",
        );
      }
      if (
        match.status !== "finished" ||
        !["not_ready", "preparing_rating"].includes(match.ratingState) ||
        resultSnapshot.exists ||
        !ballots.empty ||
        !revisions.empty
      ) {
        throw new AdminVerifiedCoachAssignmentRejectedError(
          "Verified coach recovery is not permitted in the current match state.",
        );
      }
      const trustedDate = matchSnapshot.readTime.toDate();
      const trustedAt = trustedDate.toISOString();
      if (input.externalProviderCoachId !== undefined) {
        const expectedId = providerEntityId(
          "coach",
          match.externalProvider,
          input.externalProviderCoachId,
        );
        if (expectedId !== input.coachId) {
          throw new AdminVerifiedCoachAssignmentRejectedError(
            "Coach ID must match the verified provider identity mapping.",
          );
        }
      }
      const proposedCoach: Coach = {
        id: input.coachId,
        displayName: input.coachName,
        identityProvenance: "operator_verified",
        ...(input.externalProviderCoachId === undefined
          ? {}
          : {
              externalProvider: match.externalProvider,
              externalProviderId: input.externalProviderCoachId,
            }),
        createdAt: trustedAt,
        updatedAt: trustedAt,
      };
      if (coachSnapshot.exists) {
        try {
          assertCompatibleCoach(
            fromDocument<Coach>(coachSnapshot),
            proposedCoach,
          );
        } catch (error) {
          throw new AdminVerifiedCoachAssignmentRejectedError(
            error instanceof Error
              ? error.message
              : "Coach identity conflicts with recovery.",
          );
        }
      }
      const proposedAssignment: VerifiedCoachAssignment = {
        matchId: match.id,
        trackedTeamId: match.trackedTeamId,
        externalProvider: match.externalProvider,
        externalFixtureId: match.externalProviderFixtureId,
        coachId: input.coachId,
        verificationSource: input.verificationSource,
        verificationReason: input.verificationReason,
        operatorId: input.operatorId,
        provenance: "operator_verified",
        verifiedAt: trustedAt,
        createdAt: trustedAt,
        updatedAt: trustedAt,
      };
      if (verifiedSnapshot.exists) {
        const existing =
          fromDocument<VerifiedCoachAssignment>(verifiedSnapshot);
        if (
          existing.matchId !== proposedAssignment.matchId ||
          existing.trackedTeamId !== proposedAssignment.trackedTeamId ||
          existing.externalProvider !== proposedAssignment.externalProvider ||
          existing.externalFixtureId !== proposedAssignment.externalFixtureId ||
          existing.coachId !== proposedAssignment.coachId ||
          existing.verificationSource !==
            proposedAssignment.verificationSource ||
          existing.verificationReason !==
            proposedAssignment.verificationReason ||
          existing.operatorId !== proposedAssignment.operatorId
        ) {
          throw new AdminVerifiedCoachAssignmentRejectedError(
            "Verified coach assignment conflicts with existing audit data.",
          );
        }
      }
      if (assignmentSnapshot.exists) {
        const existing = fromDocument<CoachAssignment>(assignmentSnapshot);
        if (existing.coachId !== input.coachId) {
          throw new AdminVerifiedCoachAssignmentRejectedError(
            "Current head-coach assignment conflicts with recovery.",
          );
        }
      }
      const plan: VerifiedCoachAssignmentPlan = {
        matchId: match.id,
        trackedTeamId: match.trackedTeamId,
        externalFixtureId: match.externalProviderFixtureId,
        current: {
          coachExists: coachSnapshot.exists,
          verifiedAssignmentExists: verifiedSnapshot.exists,
          ...(assignmentSnapshot.exists
            ? {
                headCoachId:
                  fromDocument<CoachAssignment>(assignmentSnapshot).coachId,
                headCoachProvenance:
                  fromDocument<CoachAssignment>(assignmentSnapshot).provenance,
              }
            : {}),
        },
        coachId: input.coachId,
        coachName: input.coachName,
        coachCreated: !coachSnapshot.exists,
        assignmentCreated: !verifiedSnapshot.exists,
        verificationSource: input.verificationSource,
        verificationReason: input.verificationReason,
      };

      if (apply) {
        if (!coachSnapshot.exists) {
          transaction.create(coachReference, toDocument(proposedCoach));
        }
        if (!verifiedSnapshot.exists) {
          transaction.create(verifiedReference, toDocument(proposedAssignment));
        }
      }
      if (challengeReference && auditReference && auditId) {
        if (!actionHash) {
          throw new Error("Admin action hash is unavailable.");
        }
        transaction.update(challengeReference, {
          consumedAt: Timestamp.fromDate(trustedDate),
          committedAuditId: auditId,
        });
        transaction.create(auditReference, {
          operatorUid: input.operatorId,
          action: "coach_assignment_apply",
          matchId: input.matchId,
          trackedTeamId: input.trackedTeamId,
          externalFixtureId: input.externalFixtureId,
          coachId: input.coachId,
          coachName: input.coachName,
          externalProviderCoachId: input.externalProviderCoachId ?? null,
          evidenceReference: input.verificationSource,
          verificationReason: input.verificationReason,
          actionHash,
          outcome: "success",
          commitDisposition: "committed",
          coachExistedBefore: plan.current.coachExists,
          verifiedAssignmentExistedBefore:
            plan.current.verifiedAssignmentExists,
          ...(plan.current.headCoachId && plan.current.headCoachProvenance
            ? {
                headCoachId: plan.current.headCoachId,
                headCoachProvenance: plan.current.headCoachProvenance,
              }
            : {}),
          coachCreated: plan.coachCreated,
          assignmentCreated: plan.assignmentCreated,
          createdAt: Timestamp.fromDate(trustedDate),
        });
        return { plan, auditId, disposition: "committed" as const };
      }
      return { plan };
    });
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === 6 || error.code === "already-exists";
}

const NOTIFICATION_LEASE_MS = 5 * 60 * 1000;
const NOTIFICATION_IDEMPOTENCY_SAFETY_MS = 23 * 60 * 60 * 1000;

export class AdminVotingWindowNotificationStore implements VotingWindowNotificationStore {
  constructor(private readonly database = getServerFirestore()) {}

  async claimVotingWindowNotification(
    matchId: string,
    attemptId: string,
  ): Promise<VotingWindowNotificationClaim> {
    return this.database.runTransaction(async (transaction) => {
      const reference = this.database.doc(`matches/${matchId}`);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return { status: "not_open" };
      const match = fromDocument<Match>(snapshot);
      const trustedAt = snapshot.readTime.toDate();
      const windowSequence = match.votingReopenCount ?? 0;
      const window = getEffectiveVotingWindow(match);
      if (
        match.status !== "finished" ||
        window === null ||
        getVotingWindowState(match, trustedAt) !== "active"
      ) {
        return { status: "not_open", windowSequence };
      }
      const sameWindow = match.votingOpenNotificationWindow === windowSequence;
      if (sameWindow && match.votingOpenNotificationStatus === "sent") {
        return { status: "already_sent", windowSequence };
      }
      if (
        sameWindow &&
        match.votingOpenNotificationStatus === "sending" &&
        match.votingOpenNotificationLeaseUntil !== undefined &&
        new Date(match.votingOpenNotificationLeaseUntil) > trustedAt
      ) {
        return { status: "in_flight", windowSequence };
      }
      const firstAttemptAt = sameWindow
        ? match.votingOpenNotificationFirstAttemptAt
        : undefined;
      if (
        firstAttemptAt !== undefined &&
        trustedAt.getTime() - new Date(firstAttemptAt).getTime() >=
          NOTIFICATION_IDEMPOTENCY_SAFETY_MS
      ) {
        return { status: "manual_review", windowSequence };
      }
      transaction.update(reference, {
        votingOpenNotificationWindow: windowSequence,
        votingOpenNotificationStatus: "sending",
        votingOpenNotificationAttemptId: attemptId,
        votingOpenNotificationFirstAttemptAt: Timestamp.fromDate(
          firstAttemptAt === undefined ? trustedAt : new Date(firstAttemptAt),
        ),
        votingOpenNotificationAttemptedAt: Timestamp.fromDate(trustedAt),
        votingOpenNotificationLeaseUntil: Timestamp.fromDate(
          new Date(trustedAt.getTime() + NOTIFICATION_LEASE_MS),
        ),
        votingOpenNotificationSentAt: FieldValue.delete(),
        votingOpenNotificationProviderId: FieldValue.delete(),
      });
      return {
        status: "claimed",
        context: {
          matchId,
          windowSequence,
          homeTeamName: match.homeTeam.name,
          awayTeamName: match.awayTeam.name,
          score: match.score,
          opensAt: window.opensAt,
          closesAt: window.closesAt,
        },
      };
    });
  }

  async markVotingWindowNotificationSent(
    matchId: string,
    windowSequence: number,
    attemptId: string,
    providerMessageId: string,
    sentAt: Date,
  ): Promise<boolean> {
    return this.database.runTransaction(async (transaction) => {
      const reference = this.database.doc(`matches/${matchId}`);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return false;
      const match = fromDocument<Match>(snapshot);
      if (
        match.votingOpenNotificationWindow !== windowSequence ||
        match.votingOpenNotificationStatus !== "sending" ||
        match.votingOpenNotificationAttemptId !== attemptId
      ) {
        return false;
      }
      transaction.update(reference, {
        votingOpenNotificationStatus: "sent",
        votingOpenNotificationSentAt: Timestamp.fromDate(sentAt),
        votingOpenNotificationProviderId: providerMessageId,
        votingOpenNotificationAttemptId: FieldValue.delete(),
        votingOpenNotificationLeaseUntil: FieldValue.delete(),
      });
      return true;
    });
  }

  async releaseVotingWindowNotification(
    matchId: string,
    windowSequence: number,
    attemptId: string,
    resetFirstAttempt: boolean,
  ): Promise<void> {
    await this.database.runTransaction(async (transaction) => {
      const reference = this.database.doc(`matches/${matchId}`);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return;
      const match = fromDocument<Match>(snapshot);
      if (
        match.votingOpenNotificationWindow !== windowSequence ||
        match.votingOpenNotificationStatus !== "sending" ||
        match.votingOpenNotificationAttemptId !== attemptId
      ) {
        return;
      }
      transaction.update(reference, {
        votingOpenNotificationStatus: "pending",
        votingOpenNotificationAttemptId: FieldValue.delete(),
        votingOpenNotificationLeaseUntil: FieldValue.delete(),
        ...(resetFirstAttempt
          ? {
              votingOpenNotificationFirstAttemptAt: FieldValue.delete(),
              votingOpenNotificationAttemptedAt: FieldValue.delete(),
            }
          : {}),
      });
    });
  }
}

export class AdminFootballSyncStore
  implements FootballSyncStore, MatchLifecycleStore, StandingsSyncStore
{
  private lifecycleAttemptId: string | undefined;

  constructor(private readonly database = getServerFirestore()) {}

  async getTeam(teamId: string): Promise<Team> {
    return this.requiredDocument<Team>(`teams/${teamId}`);
  }
  async getMatch(matchId: string): Promise<Match> {
    return this.requiredDocument<Match>(`matches/${matchId}`);
  }
  async listMatches(trackedTeamId: string): Promise<Match[]> {
    const snapshot = await this.database
      .collection("matches")
      .where("trackedTeamId", "==", trackedTeamId)
      .get();
    return snapshot.docs.map((document) => fromDocument<Match>(document));
  }
  async updateMatchLifecycle(match: Match): Promise<void> {
    await this.database.doc(`matches/${match.id}`).set(toDocument(match));
  }
  async countRateableParticipants(
    matchId: string,
    teamId: string,
  ): Promise<number> {
    const snapshot = await this.database
      .collection(`matches/${matchId}/participants`)
      .where("teamId", "==", teamId)
      .where("participated", "==", true)
      .get();
    return snapshot.size;
  }
  async hasTrackedTeamHeadCoach(
    matchId: string,
    teamId: string,
  ): Promise<boolean> {
    const snapshot = await this.database
      .doc(`matches/${matchId}/coachAssignments/head-coach`)
      .get();
    return snapshot.exists && snapshot.data()?.teamId === teamId;
  }
  async finalizeMatchResult(matchId: string, now: Date): Promise<void> {
    await this.finalizeMatchResultTransaction(matchId, now, false);
  }

  async closeVotingWindowEarly(matchId: string): Promise<Date> {
    return this.finalizeMatchResultTransaction(matchId, undefined, true);
  }

  private async finalizeMatchResultTransaction(
    matchId: string,
    requestedNow: Date | undefined,
    closeEarly: boolean,
  ): Promise<Date> {
    let finalizedAt: Date | undefined;
    await this.database.runTransaction(async (transaction) => {
      const matchReference = this.database.doc(`matches/${matchId}`);
      const resultReference = this.database.doc(
        `matches/${matchId}/results/summary`,
      );
      const participantQuery = this.database.collection(
        `matches/${matchId}/participants`,
      );
      const coachReference = this.database.doc(
        `matches/${matchId}/coachAssignments/head-coach`,
      );
      const ballotQuery = this.database.collection(
        `matches/${matchId}/ballots`,
      );
      const [
        matchSnapshot,
        resultSnapshot,
        participants,
        coachSnapshot,
        ballots,
      ] = await Promise.all([
        transaction.get(matchReference),
        transaction.get(resultReference),
        transaction.get(participantQuery),
        transaction.get(coachReference),
        transaction.get(ballotQuery),
      ]);
      if (!matchSnapshot.exists)
        throw new Error(`Match ${matchId} was not found.`);
      const match = fromDocument<Match>(matchSnapshot);
      const now = closeEarly ? matchSnapshot.readTime.toDate() : requestedNow!;
      finalizedAt = now;
      if (resultSnapshot.exists) {
        if (closeEarly) {
          throw new Error("The voting window is already finalized.");
        }
        if (match.ratingState !== "rating_closed") {
          transaction.update(matchReference, {
            ratingState: "rating_closed",
            updatedAt: Timestamp.fromDate(now),
          });
        }
        return;
      }
      const window = getEffectiveVotingWindow(match);
      if (
        match.status !== "finished" ||
        match.ratingState !== "rating_ready" ||
        window === null ||
        (closeEarly
          ? getVotingWindowState(match, now) !== "active"
          : now < new Date(window.closesAt))
      ) {
        throw new Error("Match is not eligible for result finalization.");
      }
      if (!coachSnapshot.exists)
        throw new Error("Head coach assignment is missing.");
      const result = aggregateMatchResult({
        matchId,
        teamId: match.trackedTeamId,
        participants: participants.docs.map((document) =>
          fromDocument<MatchParticipant>(document),
        ),
        coach: fromDocument<CoachAssignment>(coachSnapshot),
        ballots: ballots.docs.map((document) => fromDocument<Ballot>(document)),
        generatedAt: now.toISOString(),
      });
      transaction.create(resultReference, {
        ...result,
        generatedAt: Timestamp.fromDate(now),
      });
      transaction.update(matchReference, {
        ratingState: "rating_closed",
        ...(closeEarly ? { votingClosedEarlyAt: Timestamp.fromDate(now) } : {}),
        updatedAt: Timestamp.fromDate(now),
      });
    });
    if (finalizedAt === undefined) {
      throw new Error("Result finalization did not establish a trusted time.");
    }
    return finalizedAt;
  }
  async getSyncMetadata(teamId: string): Promise<FootballSyncMetadata | null> {
    const snapshot = await this.database
      .doc(`footballSyncMetadata/${teamId}`)
      .get();
    return snapshot.exists
      ? fromDocument<FootballSyncMetadata>(snapshot)
      : null;
  }
  async setSyncMetadata(metadata: FootballSyncMetadata): Promise<void> {
    await this.database
      .doc(`footballSyncMetadata/${metadata.teamId}`)
      .set(toDocument(metadata), { merge: true });
  }
  async claimLifecycleExecution(
    teamId: string,
    attemptId: string,
    trigger: "scheduled" | "operator",
  ): Promise<LifecycleExecutionClaim> {
    const reference = this.database.doc(`footballSyncMetadata/${teamId}`);
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const now = snapshot.readTime.toDate();
      const leaseUntil = snapshot.data()?.lifecycleLeaseUntil;
      if (
        leaseUntil instanceof Timestamp &&
        leaseUntil.toMillis() > now.getTime()
      ) {
        const data = snapshot.data();
        return {
          status: "busy" as const,
          attemptId:
            typeof data?.lifecycleAttemptId === "string"
              ? data.lifecycleAttemptId
              : "unknown",
          ...(data?.lastLifecycleTrigger === "scheduled" ||
          data?.lastLifecycleTrigger === "operator"
            ? { trigger: data.lastLifecycleTrigger }
            : {}),
          ...(typeof data?.lifecycleMatchId === "string"
            ? { matchId: data.lifecycleMatchId }
            : {}),
          ...(data?.lastLifecycleStartedAt instanceof Timestamp
            ? { startedAt: data.lastLifecycleStartedAt.toDate().toISOString() }
            : {}),
          leaseUntil: leaseUntil.toDate().toISOString(),
        };
      }
      const newLeaseUntil = Timestamp.fromMillis(now.getTime() + 5 * 60_000);
      transaction.set(
        reference,
        {
          teamId,
          lifecycleAttemptId: attemptId,
          lifecycleMatchId: FieldValue.delete(),
          lifecycleLeaseUntil: newLeaseUntil,
          lastLifecycleTrigger: trigger,
          lastLifecycleStartedAt: Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now),
        },
        { merge: true },
      );
      this.lifecycleAttemptId = attemptId;
      return {
        status: "claimed" as const,
        leaseUntil: newLeaseUntil.toDate().toISOString(),
      };
    });
  }
  async markLifecycleExecutionTarget(
    teamId: string,
    matchId: string,
  ): Promise<boolean> {
    const attemptId = this.lifecycleAttemptId;
    if (!attemptId) return true;
    const reference = this.database.doc(`footballSyncMetadata/${teamId}`);
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const leaseUntil = snapshot.data()?.lifecycleLeaseUntil;
      if (
        snapshot.data()?.lifecycleAttemptId !== attemptId ||
        !(leaseUntil instanceof Timestamp) ||
        leaseUntil.toMillis() <= snapshot.readTime.toMillis()
      ) {
        return false;
      }
      transaction.update(reference, { lifecycleMatchId: matchId });
      return true;
    });
  }
  async renewLifecycleExecution(
    teamId: string,
    attemptId: string,
  ): Promise<boolean> {
    const reference = this.database.doc(`footballSyncMetadata/${teamId}`);
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const leaseUntil = snapshot.data()?.lifecycleLeaseUntil;
      if (
        snapshot.data()?.lifecycleAttemptId !== attemptId ||
        !(leaseUntil instanceof Timestamp) ||
        leaseUntil.toMillis() <= snapshot.readTime.toMillis()
      ) {
        return false;
      }
      const now = snapshot.readTime.toDate();
      transaction.update(reference, {
        lifecycleLeaseUntil: Timestamp.fromMillis(now.getTime() + 5 * 60_000),
      });
      return true;
    });
  }
  async completeLifecycleExecution(
    teamId: string,
    attemptId: string,
    result: { action: string; matchId?: string; providerRequests: number },
  ): Promise<void> {
    const reference = this.database.doc(`footballSyncMetadata/${teamId}`);
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.lifecycleAttemptId !== attemptId) return;
      const now = snapshot.readTime.toDate();
      transaction.set(
        reference,
        {
          lifecycleAttemptId: FieldValue.delete(),
          lifecycleMatchId: FieldValue.delete(),
          lifecycleLeaseUntil: FieldValue.delete(),
          lastLifecycleCompletedAt: Timestamp.fromDate(now),
          lastLifecycleAction: result.action,
          lastLifecycleAttemptId: attemptId,
          ...(result.matchId ? { lastLifecycleMatchId: result.matchId } : {}),
          lastLifecycleProviderRequests: result.providerRequests,
          updatedAt: Timestamp.fromDate(now),
        },
        { merge: true },
      );
    });
  }
  async getStandingsTarget(
    trackedTeamId: string,
  ): Promise<StandingsSyncTarget | null> {
    const matches = await this.listMatches(trackedTeamId);
    if (matches.length === 0) return null;
    const competitionIds = [
      ...new Set(matches.map(({ competitionId }) => competitionId)),
    ];
    const seasonIds = [...new Set(matches.map(({ seasonId }) => seasonId))];
    const snapshots = await this.database.getAll(
      ...competitionIds.map((id) => this.database.doc(`competitions/${id}`)),
      ...seasonIds.map((id) => this.database.doc(`seasons/${id}`)),
    );
    const competitions = new Map<string, Competition>();
    const seasons = new Map<string, Season>();
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      if (snapshot.ref.parent.id === "competitions") {
        competitions.set(snapshot.id, fromDocument<Competition>(snapshot));
      } else if (snapshot.ref.parent.id === "seasons") {
        seasons.set(snapshot.id, fromDocument<Season>(snapshot));
      }
    }
    const selected = [...matches]
      .sort(
        (left, right) =>
          new Date(right.kickoffAt).getTime() -
          new Date(left.kickoffAt).getTime(),
      )
      .find((match) => {
        const competition = competitions.get(match.competitionId);
        const season = seasons.get(match.seasonId);
        return (
          competition?.type === "league" &&
          season?.isCurrent === true &&
          season.competitionId === competition.id &&
          competition.externalProvider === match.externalProvider &&
          season.externalProvider === match.externalProvider
        );
      });
    if (selected === undefined) return null;
    const competition = competitions.get(selected.competitionId)!;
    const season = seasons.get(selected.seasonId)!;
    return {
      trackedTeamId,
      competitionId: competition.id,
      competitionName: competition.name,
      seasonId: season.id,
      seasonName: season.name,
      externalProvider: competition.externalProvider,
      externalProviderCompetitionId: competition.externalProviderId,
      externalProviderSeason: season.externalProviderSeason,
    };
  }
  async getStandingsSnapshot(
    trackedTeamId: string,
  ): Promise<StandingsSnapshot | null> {
    const snapshot = await this.database
      .doc(`standings/${trackedTeamId}`)
      .get();
    return snapshot.exists ? fromDocument<StandingsSnapshot>(snapshot) : null;
  }
  async replaceStandingsSnapshot(snapshot: StandingsSnapshot): Promise<void> {
    await this.database.runTransaction(async (transaction) => {
      const reference = this.database.doc(`standings/${snapshot.id}`);
      const existing = await transaction.get(reference);
      const createdAt = existing.exists
        ? fromDocument<StandingsSnapshot>(existing).createdAt
        : snapshot.createdAt;
      transaction.set(reference, toDocument({ ...snapshot, createdAt }));
    });
  }
  async updateTeamProviderId(
    team: Team,
    externalProviderId: string,
  ): Promise<Team> {
    const updated = {
      ...team,
      externalProviderId,
      updatedAt: new Date().toISOString(),
    };
    await this.database.doc(`teams/${team.id}`).set(toDocument(updated));
    return updated;
  }
  upsertCompetitions(values: Competition[]) {
    return this.upsert("competitions", values);
  }
  upsertSeasons(values: Season[]) {
    return this.upsert("seasons", values);
  }
  upsertMatches(values: Match[]) {
    return this.upsert("matches", values, true);
  }
  async upsertPlayers(values: Player[]): Promise<SyncWriteCounts> {
    const unique = [
      ...new Map(values.map((value) => [value.id, value])).values(),
    ];
    if (unique.length === 0) return { created: 0, updated: 0, unchanged: 0 };
    return this.database.runTransaction(async (transaction) => {
      const playerReferences = unique.map((player) =>
        this.database.doc(`players/${player.id}`),
      );
      const memberships = unique
        .map((player) => membershipFromPlayer(player, player.updatedAt))
        .filter((value): value is TeamPlayerMembership => value !== null);
      const membershipReferences = memberships.map((membership) =>
        this.database.doc(
          `teams/${membership.teamId}/playerMemberships/${membership.playerId}`,
        ),
      );
      const [playerSnapshots, membershipSnapshots] = await Promise.all([
        transaction.getAll(...playerReferences),
        membershipReferences.length === 0
          ? Promise.resolve([])
          : transaction.getAll(...membershipReferences),
      ]);
      const candidates = unique.map((player, index) => {
        const existing = playerSnapshots[index].exists
          ? fromDocument<Player>(playerSnapshots[index])
          : undefined;
        return existing === undefined
          ? player
          : { ...existing, ...player, createdAt: existing.createdAt };
      });
      const counts = writeCounts(
        playerSnapshots.map((snapshot) =>
          snapshot.exists ? fromDocument<Player>(snapshot) : undefined,
        ),
        candidates,
      );
      candidates.forEach((player, index) => {
        transaction.set(playerReferences[index], toDocument(player));
      });
      memberships.forEach((membership, index) => {
        const snapshot = membershipSnapshots[index];
        const existing = snapshot?.exists
          ? fromDocument<TeamPlayerMembership>(snapshot)
          : undefined;
        transaction.set(
          membershipReferences[index],
          toDocument(mergeTeamPlayerMembership(existing, membership)),
        );
      });
      return counts;
    });
  }
  async resolvePlayerProviderAliases(
    values: PlayerProviderAlias[],
  ): Promise<PlayerProviderAlias[]> {
    const unique = [
      ...new Map(values.map((value) => [value.id, value])).values(),
    ];
    if (unique.length === 0) return [];
    return this.database.runTransaction(async (transaction) => {
      const references = unique.map((value) =>
        this.database.doc(`playerProviderAliases/${value.id}`),
      );
      const snapshots = await transaction.getAll(...references);
      return snapshots.map((snapshot, index) => {
        const proposed = unique[index];
        if (!snapshot.exists) {
          transaction.create(snapshot.ref, toDocument(proposed));
          return proposed;
        }
        const existing = fromDocument<PlayerProviderAlias>(snapshot);
        assertMatchingPlayerProviderAlias(existing, proposed);
        return existing;
      });
    });
  }
  upsertMatchParticipants(matchId: string, values: MatchParticipant[]) {
    return this.upsert(
      `matches/${matchId}/participants`,
      values.map((value) => ({ ...value, id: value.playerId })),
    );
  }
  async replaceMatchParticipants(
    matchId: string,
    values: MatchParticipant[],
  ): Promise<SyncWriteCounts> {
    const collection = this.database.collection(
      `matches/${matchId}/participants`,
    );
    const snapshot = await collection.get();
    const existing = new Map(
      snapshot.docs.map((document) => [
        document.id,
        fromDocument<MatchParticipant>(document),
      ]),
    );
    const incomingIds = new Set(values.map((value) => value.playerId));
    const counts = { created: 0, updated: 0, unchanged: 0 };
    const batch = this.database.batch();
    for (const value of values) {
      const current = existing.get(value.playerId);
      const candidate =
        current === undefined
          ? value
          : { ...current, ...value, createdAt: current.createdAt };
      if (current === undefined) counts.created += 1;
      else if (comparable(current) === comparable(candidate))
        counts.unchanged += 1;
      else counts.updated += 1;
      batch.set(collection.doc(value.playerId), toDocument(candidate));
    }
    for (const document of snapshot.docs) {
      if (!incomingIds.has(document.id)) {
        batch.delete(document.ref);
        counts.updated += 1;
      }
    }
    await batch.commit();
    return counts;
  }
  async getPersistedMatchContext(
    matchId: string,
    teamId: string,
    provider: string,
  ): Promise<ProviderMatchContext | null> {
    const [participantSnapshot, assignmentSnapshot] = await Promise.all([
      this.database.collection(`matches/${matchId}/participants`).get(),
      this.database.doc(`matches/${matchId}/coachAssignments/head-coach`).get(),
    ]);
    if (!assignmentSnapshot.exists) return null;
    const assignment = fromDocument<CoachAssignment>(assignmentSnapshot);
    if (assignment.teamId !== teamId) return null;
    const coachSnapshot = await this.database
      .doc(`coaches/${assignment.coachId}`)
      .get();
    if (!coachSnapshot.exists) {
      throw new Error("Verified coach identity is missing.");
    }
    const coach = fromDocument<Coach>(coachSnapshot);
    if (
      coach.externalProvider !== provider ||
      coach.externalProviderId === undefined
    )
      return null;
    const participants = participantSnapshot.docs
      .map((document) => fromDocument<MatchParticipant>(document))
      .filter(
        (participant) =>
          participant.teamId === teamId &&
          participant.externalProvider === provider &&
          participant.externalProviderPlayerId !== undefined,
      );
    if (participants.length === 0) return null;
    return {
      participants: participants.map((participant) => ({
        externalTeamId: participant.externalProviderTeamId,
        externalPlayerId: participant.externalProviderPlayerId!,
        name: participant.playerName,
        ...(participant.shirtNumber === undefined
          ? {}
          : { shirtNumber: participant.shirtNumber }),
        ...(participant.position === undefined
          ? {}
          : { position: participant.position as Player["position"] }),
        squadRole: participant.squadRole,
        participated: participant.participated,
        ...(participant.enteredAtMinute === undefined
          ? {}
          : { enteredAtMinute: participant.enteredAtMinute }),
        ...(participant.exitedAtMinute === undefined
          ? {}
          : { exitedAtMinute: participant.exitedAtMinute }),
        ...(participant.captain === undefined
          ? {}
          : { captain: participant.captain }),
      })),
      headCoach: {
        externalTeamId: assignment.externalProviderTeamId,
        externalCoachId: coach.externalProviderId,
        name: assignment.coachName,
        ...(coach.photoUrl === undefined ? {} : { photoUrl: coach.photoUrl }),
      },
    };
  }
  async getPersistedParticipantContext(
    matchId: string,
    teamId: string,
    provider: string,
  ) {
    const snapshot = await this.database
      .collection(`matches/${matchId}/participants`)
      .get();
    const participants = snapshot.docs
      .map((document) => fromDocument<MatchParticipant>(document))
      .filter(
        (participant) =>
          participant.teamId === teamId &&
          participant.externalProvider === provider &&
          participant.externalProviderPlayerId !== undefined,
      );
    if (participants.length === 0) return null;
    return {
      participants: participants.map((participant) => ({
        externalTeamId: participant.externalProviderTeamId,
        externalPlayerId: participant.externalProviderPlayerId!,
        name: participant.playerName,
        ...(participant.shirtNumber === undefined
          ? {}
          : { shirtNumber: participant.shirtNumber }),
        ...(participant.position === undefined
          ? {}
          : { position: participant.position as Player["position"] }),
        squadRole: participant.squadRole,
        participated: participant.participated,
        ...(participant.enteredAtMinute === undefined
          ? {}
          : { enteredAtMinute: participant.enteredAtMinute }),
        ...(participant.exitedAtMinute === undefined
          ? {}
          : { exitedAtMinute: participant.exitedAtMinute }),
        ...(participant.captain === undefined
          ? {}
          : { captain: participant.captain }),
      })),
    };
  }
  async getVerifiedCoachAssignment(matchId: string) {
    const assignmentSnapshot = await this.database
      .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
      .get();
    if (!assignmentSnapshot.exists) return null;
    const assignment =
      fromDocument<VerifiedCoachAssignment>(assignmentSnapshot);
    const coachSnapshot = await this.database
      .doc(`coaches/${assignment.coachId}`)
      .get();
    if (!coachSnapshot.exists) return null;
    return {
      assignment,
      coach: fromDocument<Coach>(coachSnapshot),
    };
  }
  async getVerifiedLineupSnapshot(
    matchId: string,
  ): Promise<VerifiedLineupSnapshot | null> {
    const snapshot = await this.database
      .doc(`matches/${matchId}/verifiedLineups/current`)
      .get();
    return snapshot.exists
      ? fromDocument<VerifiedLineupSnapshot>(snapshot)
      : null;
  }
  async recordVerifiedLineupReconciliation(
    value: VerifiedLineupReconciliation,
  ): Promise<void> {
    const reference = this.database.doc(
      `matches/${value.matchId}/lineupReconciliations/provider`,
    );
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.exists
        ? fromDocument<VerifiedLineupReconciliation>(snapshot)
        : null;
      const selected = selectDurableVerifiedLineupReconciliation(
        existing,
        value,
      );
      if (selected === existing) return;
      transaction.set(reference, toDocument(selected));
    });
  }
  upsertCoaches(values: Coach[]) {
    return this.upsert("coaches", values);
  }
  upsertCoachAssignment(matchId: string, value: CoachAssignment) {
    return this.upsert(`matches/${matchId}/coachAssignments`, [
      { ...value, id: "head-coach" },
    ]);
  }

  async replaceMatchParticipantContext(
    matchId: string,
    values: {
      players: Player[];
      participants: MatchParticipant[];
      coach: Coach;
      assignment: CoachAssignment;
    },
  ) {
    return this.database.runTransaction(async (transaction) => {
      const matchReference = this.database.doc(`matches/${matchId}`);
      const resultReference = this.database.doc(
        `matches/${matchId}/results/summary`,
      );
      const ballotQuery = this.database.collection(
        `matches/${matchId}/ballots`,
      );
      const participantCollection = this.database.collection(
        `matches/${matchId}/participants`,
      );
      const coachReference = this.database.doc(`coaches/${values.coach.id}`);
      const assignmentReference = this.database.doc(
        `matches/${matchId}/coachAssignments/head-coach`,
      );
      const verifiedReference = this.database.doc(
        `matches/${matchId}/verifiedCoachAssignments/head-coach`,
      );
      const verifiedLineupReference = this.database.doc(
        `matches/${matchId}/verifiedLineups/current`,
      );
      const playerReferences = values.players.map((player) =>
        this.database.doc(`players/${player.id}`),
      );
      const memberships = [
        ...new Map(
          values.participants.map((participant) => {
            const membership = membershipFromParticipant(participant);
            return [membership.playerId, membership] as const;
          }),
        ).values(),
      ];
      const membershipReferences = memberships.map((membership) =>
        this.database.doc(
          `teams/${membership.teamId}/playerMemberships/${membership.playerId}`,
        ),
      );
      const matchSnapshot = await transaction.get(matchReference);
      const resultSnapshot = await transaction.get(resultReference);
      const ballots = await transaction.get(ballotQuery);
      const participantSnapshot = await transaction.get(participantCollection);
      const playerSnapshots =
        playerReferences.length === 0
          ? []
          : await transaction.getAll(...playerReferences);
      const membershipSnapshots =
        membershipReferences.length === 0
          ? []
          : await transaction.getAll(...membershipReferences);
      const coachSnapshot = await transaction.get(coachReference);
      const assignmentSnapshot = await transaction.get(assignmentReference);
      const verifiedSnapshot = await transaction.get(verifiedReference);
      const verifiedLineupSnapshot = await transaction.get(
        verifiedLineupReference,
      );
      if (!matchSnapshot.exists) throw new Error("Match was not found.");
      const match = fromDocument<Match>(matchSnapshot);
      if (
        match.ratingState === "rating_ready" ||
        match.ratingState === "rating_closed" ||
        resultSnapshot.exists ||
        !ballots.empty
      ) {
        throw new Error(
          "Participant context cannot change after voting data or results exist.",
        );
      }
      if (
        values.assignment.matchId !== matchId ||
        values.assignment.teamId !== match.trackedTeamId ||
        values.assignment.coachId !== values.coach.id ||
        values.participants.some(
          (participant) =>
            participant.matchId !== matchId ||
            participant.teamId !== match.trackedTeamId,
        )
      ) {
        throw new Error(
          "Participant context does not match the tracked match.",
        );
      }
      if (values.assignment.provenance === "operator_verified") {
        if (!verifiedSnapshot.exists) {
          throw new Error("Verified coach assignment is missing.");
        }
        const verified =
          fromDocument<VerifiedCoachAssignment>(verifiedSnapshot);
        if (
          verified.matchId !== matchId ||
          verified.trackedTeamId !== match.trackedTeamId ||
          verified.externalProvider !== match.externalProvider ||
          verified.externalFixtureId !== match.externalProviderFixtureId ||
          verified.coachId !== values.coach.id
        ) {
          throw new Error("Verified coach assignment binding is invalid.");
        }
      } else if (verifiedSnapshot.exists) {
        throw new Error(
          "Provider synchronization cannot replace a verified coach assignment.",
        );
      }
      if (assignmentSnapshot.exists) {
        const existing = fromDocument<CoachAssignment>(assignmentSnapshot);
        if (
          existing.coachId !== values.assignment.coachId ||
          (existing.provenance === "operator_verified" &&
            values.assignment.provenance !== "operator_verified")
        ) {
          throw new Error("Existing coach assignment conflicts with sync.");
        }
      }
      if (coachSnapshot.exists) {
        assertCompatibleCoach(fromDocument<Coach>(coachSnapshot), values.coach);
      }

      const players = writeCounts(
        playerSnapshots.map((snapshot) =>
          snapshot.exists ? fromDocument<Player>(snapshot) : undefined,
        ),
        values.players,
      );
      values.players.forEach((player, index) => {
        const existing = playerSnapshots[index].exists
          ? fromDocument<Player>(playerSnapshots[index])
          : undefined;
        transaction.set(
          playerReferences[index],
          toDocument(
            existing === undefined
              ? player
              : { ...existing, ...player, createdAt: existing.createdAt },
          ),
        );
      });
      memberships.forEach((membership, index) => {
        const snapshot = membershipSnapshots[index];
        const existing = snapshot.exists
          ? fromDocument<TeamPlayerMembership>(snapshot)
          : undefined;
        transaction.set(
          membershipReferences[index],
          toDocument(mergeTeamPlayerMembership(existing, membership)),
        );
      });

      const existingParticipants = new Map(
        participantSnapshot.docs.map((document) => [
          document.id,
          fromDocument<MatchParticipant>(document),
        ]),
      );
      const participantValues = verifiedLineupSnapshot.exists
        ? preserveVerifiedParticipants(
            fromDocument<VerifiedLineupSnapshot>(verifiedLineupSnapshot),
            existingParticipants,
            values.participants,
            match,
          )
        : values.participants;
      const participantCounts = { created: 0, updated: 0, unchanged: 0 };
      const incomingIds = new Set<string>();
      for (const participant of participantValues) {
        incomingIds.add(participant.playerId);
        const existing = existingParticipants.get(participant.playerId);
        const candidate =
          existing === undefined
            ? participant
            : { ...existing, ...participant, createdAt: existing.createdAt };
        if (existing === undefined) participantCounts.created += 1;
        else if (comparable(existing) === comparable(candidate))
          participantCounts.unchanged += 1;
        else participantCounts.updated += 1;
        transaction.set(
          participantCollection.doc(participant.playerId),
          toDocument(candidate),
        );
      }
      for (const document of participantSnapshot.docs) {
        if (!incomingIds.has(document.id)) {
          transaction.delete(document.ref);
          participantCounts.updated += 1;
        }
      }

      const existingCoach = coachSnapshot.exists
        ? fromDocument<Coach>(coachSnapshot)
        : undefined;
      const coachCandidate =
        existingCoach === undefined
          ? values.coach
          : {
              ...existingCoach,
              ...values.coach,
              createdAt: existingCoach.createdAt,
            };
      const coaches = writeCounts([existingCoach], [coachCandidate]);
      transaction.set(coachReference, toDocument(coachCandidate));

      const existingAssignment = assignmentSnapshot.exists
        ? fromDocument<CoachAssignment>(assignmentSnapshot)
        : undefined;
      const assignmentCandidate =
        existingAssignment === undefined
          ? values.assignment
          : {
              ...existingAssignment,
              ...values.assignment,
              createdAt: existingAssignment.createdAt,
            };
      const coachAssignments = writeCounts(
        [existingAssignment],
        [assignmentCandidate],
      );
      transaction.set(assignmentReference, toDocument(assignmentCandidate));
      return {
        players,
        participants: participantCounts,
        coaches,
        coachAssignments,
      };
    });
  }

  private async requiredDocument<T extends { id: string }>(
    path: string,
  ): Promise<T> {
    const snapshot = await this.database.doc(path).get();
    if (!snapshot.exists) throw new Error(`${path} was not found.`);
    return fromDocument<T>(snapshot);
  }
  private async upsert<T extends { id: string; createdAt: string }>(
    collection: string,
    values: T[],
    preserveLifecycle = false,
  ): Promise<SyncWriteCounts> {
    const counts = { created: 0, updated: 0, unchanged: 0 };
    for (const incoming of values) {
      const reference = this.database.doc(`${collection}/${incoming.id}`);
      const snapshot = await reference.get();
      if (!snapshot.exists) {
        await reference.create(toDocument(incoming));
        counts.created += 1;
        continue;
      }
      const existing = fromDocument<T>(snapshot);
      const merged = preserveLifecycle
        ? (preserveMatchLifecycle(
            existing as unknown as Match,
            incoming as unknown as Match,
          ) as unknown as T)
        : ({ ...existing, ...incoming, createdAt: existing.createdAt } as T);
      if (comparable(existing) === comparable(merged)) counts.unchanged += 1;
      else {
        await reference.set(toDocument(merged));
        counts.updated += 1;
      }
    }
    return counts;
  }
}

function compareParticipants(
  left: MatchParticipant,
  right: MatchParticipant,
): number {
  const positionRank = (position: string | undefined) => {
    const normalized = position?.toLowerCase() ?? "";
    if (normalized.includes("goal") || normalized === "g") return 0;
    if (normalized.includes("def") || normalized === "d") return 1;
    if (normalized.includes("mid") || normalized === "m") return 2;
    if (
      normalized.includes("att") ||
      normalized.includes("for") ||
      normalized === "f"
    )
      return 3;
    return 4;
  };
  return (
    positionRank(left.position) - positionRank(right.position) ||
    Number(left.shirtNumber ?? 999) - Number(right.shirtNumber ?? 999) ||
    left.playerName.localeCompare(right.playerName)
  );
}

function requireAuditableWindow(match: Match) {
  const window = getEffectiveVotingWindow(match);
  if (
    window === null ||
    !validTimestamp(window.opensAt) ||
    !validTimestamp(window.closesAt) ||
    new Date(window.opensAt) >= new Date(window.closesAt) ||
    match.votingOpensAt === undefined ||
    match.votingClosesAt === undefined ||
    !validTimestamp(match.votingOpensAt) ||
    !validTimestamp(match.votingClosesAt)
  ) {
    throw new Error("Persisted voting timestamps are incomplete or malformed.");
  }
  if (
    window.reopened &&
    (match.votingReopenedAt === undefined ||
      !validTimestamp(match.votingReopenedAt) ||
      !Number.isInteger(match.votingReopenCount) ||
      match.votingReopenCount! < 1)
  ) {
    throw new Error("Persisted reopen metadata is incomplete or malformed.");
  }
  return window;
}

function validateReopenCloseTime(requested: Date, trustedAt: Date) {
  const duration = requested.getTime() - trustedAt.getTime();
  if (
    !Number.isFinite(requested.getTime()) ||
    duration < 5 * 60 * 1000 ||
    duration > 24 * 60 * 60 * 1000
  ) {
    throw new Error(
      "The reopen close time must be between 5 minutes and 24 hours after trusted time.",
    );
  }
}

function validTimestamp(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

function isCompatibleCurrentResult(match: Match, result: MatchResult): boolean {
  if (
    result.matchId !== match.id ||
    result.teamId !== match.trackedTeamId ||
    !Number.isInteger(result.ballotCount) ||
    result.ballotCount < 0 ||
    (result.status !== "final" && result.status !== "no_votes") ||
    typeof result.generatedAt !== "string" ||
    !validTimestamp(result.generatedAt) ||
    !isRecord(result.playerResults) ||
    !isRecord(result.coachResult) ||
    !Array.isArray(result.mvpPlayerIds)
  ) {
    return false;
  }
  const playerResults = Object.entries(result.playerResults);
  if (playerResults.length === 0) return false;
  const orders = new Set<number>();
  for (const [playerId, value] of playerResults) {
    if (
      !isRecord(value) ||
      value.playerId !== playerId ||
      typeof value.playerName !== "string" ||
      value.playerName.length === 0 ||
      !validAggregateRating(value.average) ||
      value.voteCount !== result.ballotCount ||
      !Number.isInteger(value.order) ||
      (value.order as number) < 0 ||
      orders.has(value.order as number)
    ) {
      return false;
    }
    orders.add(value.order as number);
  }
  const coach = result.coachResult;
  if (
    typeof coach.coachId !== "string" ||
    coach.coachId.length === 0 ||
    typeof coach.coachName !== "string" ||
    coach.coachName.length === 0 ||
    !validAggregateRating(coach.average) ||
    coach.voteCount !== result.ballotCount
  ) {
    return false;
  }
  if (
    result.mvpPlayerIds.some(
      (playerId) =>
        typeof playerId !== "string" || !(playerId in result.playerResults),
    ) ||
    new Set(result.mvpPlayerIds).size !== result.mvpPlayerIds.length
  ) {
    return false;
  }
  return result.status === "no_votes"
    ? result.ballotCount === 0 && result.mvpPlayerIds.length === 0
    : result.ballotCount > 0 && result.mvpPlayerIds.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validAggregateRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10
  );
}

function requireCanonicalCurrentResult(
  result: MatchResult,
  expected: MatchResult,
): void {
  if (
    typeof result.generatedAt !== "string" ||
    !validTimestamp(result.generatedAt)
  ) {
    throw new Error("The current result summary is malformed.");
  }
  const current = { ...result } as Record<string, unknown>;
  delete current.id;
  if (
    !isDeepStrictEqual(current, {
      ...expected,
      generatedAt: result.generatedAt,
    })
  ) {
    throw new Error("The current result summary is malformed or inconsistent.");
  }
}

function planCurrent(
  match: Match,
  ballotCount: number,
  resultSummaryExists: boolean,
  resultGeneratedAt: string | undefined,
): VotingWindowPlan["current"] {
  const window = requireAuditableWindow(match);
  return {
    status: match.status,
    ratingState: match.ratingState,
    ...(match.ratingReadyAt === undefined
      ? {}
      : { ratingReadyAt: match.ratingReadyAt }),
    ...(match.votingOpensAt === undefined
      ? {}
      : { originalVotingOpensAt: match.votingOpensAt }),
    ...(match.votingClosesAt === undefined
      ? {}
      : { originalVotingClosesAt: match.votingClosesAt }),
    effectiveVotingOpensAt: window.opensAt,
    effectiveVotingClosesAt: window.closesAt,
    reopened: window.reopened,
    votingReopenCount: match.votingReopenCount ?? 0,
    resultSummaryExists,
    ...(resultGeneratedAt === undefined ? {} : { resultGeneratedAt }),
    ballotCount,
  };
}

function reopenPlan({
  match,
  result,
  ballotCount,
  trustedAt,
  requestedClosesAt,
  archivePath,
}: {
  match: Match;
  result: MatchResult;
  ballotCount: number;
  trustedAt: Date;
  requestedClosesAt: Date;
  archivePath: string;
}): VotingWindowPlan {
  return {
    operation: "reopen",
    matchId: match.id,
    trustedAt: trustedAt.toISOString(),
    current: planCurrent(match, ballotCount, true, result.generatedAt),
    proposed: {
      effectiveVotingOpensAt: trustedAt.toISOString(),
      effectiveVotingClosesAt: requestedClosesAt.toISOString(),
      archivePath,
      changes: [
        `create ${archivePath}`,
        `delete matches/${match.id}/results/summary`,
        `update matches/${match.id}: ratingState, votingReopenedAt, votingReopenCount, effectiveVotingOpensAt, effectiveVotingClosesAt, votingOpenNotificationWindow, votingOpenNotificationStatus, updatedAt`,
        `preserve matches/${match.id}/ballots/* unchanged`,
      ],
      finalizesImmediately: false,
    },
  };
}

function toDocument(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, field]) => key !== "id" && field !== undefined)
      .map(([key, field]) => [
        key,
        TIMESTAMP_FIELDS.has(key) && typeof field === "string"
          ? Timestamp.fromDate(new Date(field))
          : field,
      ]),
  );
}
function fromDocument<T>(snapshot: {
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
function comparable(value: object): string {
  const copy = { ...value } as Record<string, unknown>;
  delete copy.updatedAt;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(copy).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

function assertMatchingPlayerProviderAlias(
  existing: PlayerProviderAlias,
  proposed: PlayerProviderAlias,
): void {
  if (
    existing.canonicalPlayerId !== proposed.canonicalPlayerId ||
    existing.canonicalExternalProviderPlayerId !==
      proposed.canonicalExternalProviderPlayerId ||
    existing.externalProvider !== proposed.externalProvider ||
    existing.externalProviderPlayerId !== proposed.externalProviderPlayerId
  ) {
    throw new Error(
      `Player provider alias ${proposed.id} conflicts with its persisted canonical identity.`,
    );
  }
}

function preserveVerifiedParticipants(
  verified: VerifiedLineupSnapshot,
  existing: ReadonlyMap<string, MatchParticipant>,
  providerParticipants: readonly MatchParticipant[],
  match: Match,
): MatchParticipant[] {
  if (
    verified.matchId !== match.id ||
    verified.trackedTeamId !== match.trackedTeamId ||
    verified.externalProvider !== match.externalProvider ||
    verified.externalFixtureId !== match.externalProviderFixtureId ||
    verified.provenance !== "operator_verified"
  ) {
    throw new Error("Verified lineup binding conflicts with sync.");
  }
  const verifiedById = new Map(
    verified.participants.map((participant) => [
      participant.playerId,
      participant,
    ]),
  );
  if (verifiedById.size !== verified.participants.length) {
    throw new Error("Verified lineup contains duplicate identities.");
  }
  const providerIds = new Set(
    providerParticipants.map((participant) => participant.playerId),
  );
  if (providerIds.size !== providerParticipants.length) {
    throw new Error(
      "Provider participants contain duplicate canonical identities that conflict with the verified lineup.",
    );
  }
  for (const providerParticipant of providerParticipants) {
    const manual = verifiedById.get(providerParticipant.playerId);
    if (manual === undefined) {
      throw new Error(
        "Provider participant identity conflicts with the verified lineup.",
      );
    }
    if (
      providerParticipant.squadRole !== manual.squadRole ||
      (providerParticipant.participated && !manual.participated)
    ) {
      throw new Error(
        "Provider participation conflicts with the verified lineup.",
      );
    }
  }
  return verified.participants.map((manual) => {
    const participant = existing.get(manual.playerId);
    if (
      participant === undefined ||
      participant.matchId !== match.id ||
      participant.teamId !== match.trackedTeamId ||
      participant.playerName !== manual.playerName ||
      participant.squadRole !== manual.squadRole ||
      participant.participated !== manual.participated ||
      participant.participationStatus !== manual.participationStatus ||
      participant.participationProvenance !== "operator_verified" ||
      participant.verificationSource !== manual.verificationSource ||
      participant.verificationReason !== manual.verificationReason ||
      participant.verifiedBy !== manual.verifiedBy ||
      participant.verifiedAt !== isoTimestamp(manual.verifiedAt)
    ) {
      throw new Error(
        "Persisted participant conflicts with the verified lineup.",
      );
    }
    return participant;
  });
}

function isoTimestamp(value: unknown): unknown {
  return value instanceof Timestamp ? value.toDate().toISOString() : value;
}

function assertCompatibleCoach(existing: Coach, proposed: Coach): void {
  if (
    existing.id !== proposed.id ||
    existing.displayName !== proposed.displayName ||
    (existing.externalProvider !== undefined &&
      proposed.externalProvider !== undefined &&
      existing.externalProvider !== proposed.externalProvider) ||
    (existing.externalProviderId !== undefined &&
      proposed.externalProviderId !== undefined &&
      existing.externalProviderId !== proposed.externalProviderId)
  ) {
    throw new Error("Coach identity conflicts with the existing record.");
  }
  if (
    (existing.externalProvider === undefined) !==
      (existing.externalProviderId === undefined) ||
    (proposed.externalProvider === undefined) !==
      (proposed.externalProviderId === undefined)
  ) {
    throw new Error("Coach provider identity is incomplete.");
  }
}

function validVerificationSource(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function writeCounts<T extends object>(
  existing: Array<T | undefined>,
  proposed: T[],
): SyncWriteCounts {
  return proposed.reduce<SyncWriteCounts>(
    (counts, value, index) => {
      const current = existing[index];
      if (current === undefined) counts.created += 1;
      else if (comparable(current) === comparable(value)) counts.unchanged += 1;
      else counts.updated += 1;
      return counts;
    },
    { created: 0, updated: 0, unchanged: 0 },
  );
}

function preserveMatchLifecycle(existing: Match, incoming: Match): Match {
  return {
    ...existing,
    ...incoming,
    createdAt: existing.createdAt,
    ratingState: existing.ratingState ?? incoming.ratingState,
    status: preserveMonotonicMatchStatus(
      existing.status,
      incoming.status,
      existing.ratingState ?? incoming.ratingState,
    ),
    ...(existing.lastProviderSyncAt === undefined
      ? {}
      : { lastProviderSyncAt: existing.lastProviderSyncAt }),
    ...(existing.lineupSnapshotAt === undefined
      ? {}
      : { lineupSnapshotAt: existing.lineupSnapshotAt }),
    ...(existing.lineupCaptureAttempts === undefined
      ? {}
      : { lineupCaptureAttempts: existing.lineupCaptureAttempts }),
    ...(existing.liveLineupCaptureAttempts === undefined
      ? {}
      : { liveLineupCaptureAttempts: existing.liveLineupCaptureAttempts }),
    ...(existing.lineupCaptureLastAttemptAt === undefined
      ? {}
      : { lineupCaptureLastAttemptAt: existing.lineupCaptureLastAttemptAt }),
    ...(existing.lineupCaptureLastOutcome === undefined
      ? {}
      : { lineupCaptureLastOutcome: existing.lineupCaptureLastOutcome }),
    ...(existing.participantSyncedAt === undefined
      ? {}
      : { participantSyncedAt: existing.participantSyncedAt }),
    ...(existing.ratingReadyAt === undefined
      ? {}
      : { ratingReadyAt: existing.ratingReadyAt }),
    ...(existing.votingOpensAt === undefined
      ? {}
      : { votingOpensAt: existing.votingOpensAt }),
    ...(existing.votingClosesAt === undefined
      ? {}
      : { votingClosesAt: existing.votingClosesAt }),
    ...(existing.votingReopenedAt === undefined
      ? {}
      : { votingReopenedAt: existing.votingReopenedAt }),
    ...(existing.votingReopenCount === undefined
      ? {}
      : { votingReopenCount: existing.votingReopenCount }),
    ...(existing.effectiveVotingOpensAt === undefined
      ? {}
      : { effectiveVotingOpensAt: existing.effectiveVotingOpensAt }),
    ...(existing.effectiveVotingClosesAt === undefined
      ? {}
      : { effectiveVotingClosesAt: existing.effectiveVotingClosesAt }),
    ...(existing.votingClosedEarlyAt === undefined
      ? {}
      : { votingClosedEarlyAt: existing.votingClosedEarlyAt }),
    ...(existing.votingOpenNotificationWindow === undefined
      ? {}
      : {
          votingOpenNotificationWindow: existing.votingOpenNotificationWindow,
        }),
    ...(existing.votingOpenNotificationStatus === undefined
      ? {}
      : {
          votingOpenNotificationStatus: existing.votingOpenNotificationStatus,
        }),
    ...(existing.votingOpenNotificationAttemptId === undefined
      ? {}
      : {
          votingOpenNotificationAttemptId:
            existing.votingOpenNotificationAttemptId,
        }),
    ...(existing.votingOpenNotificationFirstAttemptAt === undefined
      ? {}
      : {
          votingOpenNotificationFirstAttemptAt:
            existing.votingOpenNotificationFirstAttemptAt,
        }),
    ...(existing.votingOpenNotificationAttemptedAt === undefined
      ? {}
      : {
          votingOpenNotificationAttemptedAt:
            existing.votingOpenNotificationAttemptedAt,
        }),
    ...(existing.votingOpenNotificationLeaseUntil === undefined
      ? {}
      : {
          votingOpenNotificationLeaseUntil:
            existing.votingOpenNotificationLeaseUntil,
        }),
    ...(existing.votingOpenNotificationSentAt === undefined
      ? {}
      : {
          votingOpenNotificationSentAt: existing.votingOpenNotificationSentAt,
        }),
    ...(existing.votingOpenNotificationProviderId === undefined
      ? {}
      : {
          votingOpenNotificationProviderId:
            existing.votingOpenNotificationProviderId,
        }),
  };
}
