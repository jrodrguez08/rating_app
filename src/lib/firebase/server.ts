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
  PLAYER_HISTORY_MATCH_LIMIT,
  type PlayerCatalog,
  type PlayerIdentity,
} from "@/application/player-history";
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
} from "@/domain/models";
import type {
  FootballSyncStore,
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
} from "@/domain/player-identity";
import {
  getEffectiveVotingWindow,
  getVotingWindowState,
} from "@/domain/voting-window";
import { readFirebaseAdminRuntimeConfig } from "@/lib/server/environment";

const TIMESTAMP_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "kickoffAt",
  "lastProviderSyncAt",
  "lineupSnapshotAt",
  "participantSyncedAt",
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
  "archivedAt",
  "windowOpensAt",
  "windowClosesAt",
  "windowReopenedAt",
  "windowClosedEarlyAt",
  "generatedAt",
  "lastFixtureDiscoveryAt",
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
        participantSnapshot.docs.map((snapshot) => {
          const participant = fromDocument<MatchParticipant>(snapshot);
          return playerProviderAliasId(
            participant.externalProvider,
            participant.externalProviderPlayerId,
          );
        }),
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
    const [team, matchSnapshot, participantSnapshot] = await Promise.all([
      store.getTeam(teamId),
      this.database
        .collection("matches")
        .where("trackedTeamId", "==", teamId)
        .orderBy("kickoffAt", "desc")
        .limit(PLAYER_HISTORY_MATCH_LIMIT)
        .get(),
      this.database
        .collectionGroup("participants")
        .where("teamId", "==", teamId)
        .limit(500)
        .get(),
    ]);
    if (team.externalProviderId === undefined)
      throw new Error(`Tracked Team ${teamId} has no provider mapping.`);
    const matches = matchSnapshot.docs.map((snapshot) =>
      fromDocument<Match>(snapshot),
    );
    const resultSnapshots =
      matches.length === 0
        ? []
        : await this.database.getAll(
            ...matches.map((match) =>
              this.database.doc(`matches/${match.id}/results/summary`),
            ),
          );
    const results = resultSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => fromDocument<MatchResult>(snapshot));
    const participants = participantSnapshot.docs.map((snapshot) =>
      fromDocument<MatchParticipant>(snapshot),
    );
    const participantIdentities = participants.map((participant) => ({
      id: participant.playerId,
      name: participant.playerName,
    }));
    const aliasIds = [
      ...new Set(
        participants.map((participant) =>
          playerProviderAliasId(
            participant.externalProvider,
            participant.externalProviderPlayerId,
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
    const aliases = aliasSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => fromDocument<PlayerProviderAlias>(snapshot));
    const canonicalPlayerIds = canonicalPlayerIdMap(aliases);
    const playerIds = [
      ...new Set([
        ...participantIdentities.map(({ id }) => id),
        ...results.flatMap((result) => Object.keys(result.playerResults)),
        ...aliases.map(({ canonicalPlayerId }) => canonicalPlayerId),
      ]),
    ];
    const playerSnapshots =
      playerIds.length === 0
        ? []
        : await this.database.getAll(
            ...playerIds.map((id) => this.database.doc(`players/${id}`)),
          );
    const persistedIdentities = playerSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => {
        const player = fromDocument<Player>(snapshot);
        return {
          id: player.id,
          name: player.displayName,
          ...(player.position === undefined
            ? {}
            : { position: player.position }),
          ...(player.photoUrl === undefined
            ? {}
            : { photoUrl: player.photoUrl }),
        };
      });
    return buildPlayerCatalog({
      identities: mergePlayerIdentities(
        participantIdentities,
        persistedIdentities,
      ),
      matches,
      results,
      trackedTeamExternalProviderId: team.externalProviderId,
      canonicalPlayerIds,
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
          : { position: participant.position }),
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
      .set(toDocument(metadata));
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
  upsertPlayers(values: Player[]) {
    return this.upsert("players", values);
  }
  async resolvePlayerProviderAliases(
    values: PlayerProviderAlias[],
  ): Promise<PlayerProviderAlias[]> {
    const unique = [
      ...new Map(values.map((value) => [value.id, value])).values(),
    ];
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
    if (!coachSnapshot.exists) return null;
    const coach = fromDocument<Coach>(coachSnapshot);
    if (coach.externalProvider !== provider) return null;
    const participants = participantSnapshot.docs
      .map((document) => fromDocument<MatchParticipant>(document))
      .filter(
        (participant) =>
          participant.teamId === teamId &&
          participant.externalProvider === provider,
      );
    if (participants.length === 0) return null;
    return {
      participants: participants.map((participant) => ({
        externalTeamId: participant.externalProviderTeamId,
        externalPlayerId: participant.externalProviderPlayerId,
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
  upsertCoaches(values: Coach[]) {
    return this.upsert("coaches", values);
  }
  upsertCoachAssignment(matchId: string, value: CoachAssignment) {
    return this.upsert(`matches/${matchId}/coachAssignments`, [
      { ...value, id: "head-coach" },
    ]);
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

function mergePlayerIdentities(
  snapshots: PlayerIdentity[],
  persisted: PlayerIdentity[],
) {
  const identities = new Map(snapshots.map((value) => [value.id, value]));
  for (const value of persisted) identities.set(value.id, value);
  return [...identities.values()];
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
