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
import { validateBallotRatings } from "@/domain/ballot-validation";
import { preserveMonotonicMatchStatus } from "@/domain/match-status";
import { aggregateMatchResult } from "@/domain/result-aggregation";
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
  Season,
  Team,
} from "@/domain/models";
import type {
  FootballSyncStore,
  MatchLifecycleStore,
  SyncWriteCounts,
} from "@/domain/ports";
import { readFirebaseAdminRuntimeConfig } from "@/lib/server/environment";

const TIMESTAMP_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "kickoffAt",
  "lastProviderSyncAt",
  "participantSyncedAt",
  "ratingReadyAt",
  "votingOpensAt",
  "votingClosesAt",
  "lastFixtureDiscoveryAt",
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
    if (
      match.votingClosesAt === undefined ||
      now < new Date(match.votingClosesAt)
    ) {
      return { state: "locked", match };
    }
    const resultSnapshot = await this.database
      .doc(`matches/${matchId}/results/summary`)
      .get();
    if (!resultSnapshot.exists || match.ratingState !== "rating_closed") {
      return { state: "preparing", match };
    }
    return {
      state: "ready",
      match,
      result: fromDocument<MatchResult>(resultSnapshot),
    };
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

export class AdminBallotService {
  constructor(private readonly database = getServerFirestore()) {}

  async getPageState(
    matchId: string,
    now = new Date(),
  ): Promise<BallotPageState> {
    const matchSnapshot = await this.database.doc(`matches/${matchId}`).get();
    if (!matchSnapshot.exists) return { state: "unavailable" };
    const match = fromDocument<Match>(matchSnapshot);
    const windowState = getWindowState(match, now);
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
        votingClosesAt: match.votingClosesAt!,
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
      const windowState = getWindowState(match, now);
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

export class AdminFootballSyncStore
  implements FootballSyncStore, MatchLifecycleStore
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
      if (resultSnapshot.exists) {
        if (match.ratingState !== "rating_closed") {
          transaction.update(matchReference, {
            ratingState: "rating_closed",
            updatedAt: Timestamp.fromDate(now),
          });
        }
        return;
      }
      if (
        match.status !== "finished" ||
        match.ratingState !== "rating_ready" ||
        match.votingClosesAt === undefined ||
        now < new Date(match.votingClosesAt)
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
        updatedAt: Timestamp.fromDate(now),
      });
    });
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
  upsertMatchParticipants(matchId: string, values: MatchParticipant[]) {
    return this.upsert(
      `matches/${matchId}/participants`,
      values.map((value) => ({ ...value, id: value.playerId })),
    );
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

function getWindowState(
  match: Match,
  now: Date,
): "active" | "not_open" | "closed" {
  if (
    match.ratingState !== "rating_ready" ||
    match.votingOpensAt === undefined ||
    match.votingClosesAt === undefined
  ) {
    return "not_open";
  }
  if (now < new Date(match.votingOpensAt)) return "not_open";
  if (now >= new Date(match.votingClosesAt)) return "closed";
  return "active";
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
    id: snapshot.id,
    ...Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof Timestamp ? value.toDate().toISOString() : value,
      ]),
    ),
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
  };
}
