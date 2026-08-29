import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

import { preserveMonotonicMatchStatus } from "@/domain/match-status";
import type {
  Coach,
  CoachAssignment,
  Competition,
  FootballSyncMetadata,
  Match,
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
  if (getApps().length === 0) {
    const projectId = required("FIREBASE_ADMIN_PROJECT_ID");
    const emulator = process.env.FIRESTORE_EMULATOR_HOST !== undefined;
    initializeApp({
      projectId,
      credential: emulator
        ? applicationDefault()
        : cert({
            projectId,
            clientEmail: required("FIREBASE_ADMIN_CLIENT_EMAIL"),
            privateKey: required("FIREBASE_ADMIN_PRIVATE_KEY").replace(
              /\\n/g,
              "\n",
            ),
          }),
    });
  }
  return getFirestore();
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

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "")
    throw new Error(`${name} is required for trusted lifecycle persistence.`);
  return value;
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
