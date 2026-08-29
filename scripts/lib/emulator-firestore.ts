import { preserveMonotonicMatchStatus } from "@/domain/match-status";
import { aggregateMatchResult } from "@/domain/result-aggregation";
import type {
  Ballot,
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

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields: Record<string, FirestoreValue> } };

interface RestDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

function parseHost(value: string): { host: string; port: number } {
  const separator = value.lastIndexOf(":");
  if (separator < 1)
    throw new Error("FIRESTORE_EMULATOR_HOST must include a port.");
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  if (!LOCAL_HOSTS.has(host) || !Number.isInteger(port)) {
    throw new Error(
      "Football sync writes are restricted to a local Firestore emulator.",
    );
  }
  return { host, port };
}

function encode(value: unknown, key?: string): FirestoreValue {
  if (
    key === "createdAt" ||
    key === "updatedAt" ||
    key === "kickoffAt" ||
    key === "lastProviderSyncAt" ||
    key === "participantSyncedAt" ||
    key === "ratingReadyAt" ||
    key === "votingOpensAt" ||
    key === "votingClosesAt" ||
    key === "generatedAt" ||
    key === "lastFixtureDiscoveryAt"
  ) {
    if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
      throw new Error(`${key} must be an ISO timestamp.`);
    }
    return { timestampValue: value };
  }
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((field) => encode(field)) } };
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return {
      mapValue: { fields: encodeFields(value as Record<string, unknown>) },
    };
  }
  throw new Error(`Unsupported Firestore value for ${key ?? "field"}.`);
}

function encodeFields(
  value: Record<string, unknown>,
): Record<string, FirestoreValue> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .map(([key, field]) => [key, encode(field, key)]),
  );
}

function decode(value: FirestoreValue): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value)
    return new Date(value.timestampValue).toISOString();
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decode);
  return decodeFields(value.mapValue.fields);
}

function decodeFields(
  fields: Record<string, FirestoreValue> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decode(value)]),
  );
}

function comparable(value: Record<string, unknown>) {
  const copy = { ...value };
  delete copy.createdAt;
  delete copy.updatedAt;
  return JSON.stringify(sortObject(copy));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => [key, sortObject(field)]),
  );
}

export class EmulatorFootballSyncStore
  implements FootballSyncStore, MatchLifecycleStore
{
  private readonly baseUrl: string;

  constructor(
    emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080",
    private readonly projectId = process.env.GCLOUD_PROJECT ??
      "demo-rating-app-local",
  ) {
    if (!projectId.startsWith("demo-")) {
      throw new Error("Football sync requires a demo-* Firebase project ID.");
    }
    const { host, port } = parseHost(emulatorHost);
    this.baseUrl = `http://${host}:${port}/v1/projects/${projectId}/databases/(default)/documents`;
  }

  async getTeam(teamId: string): Promise<Team> {
    const value = await this.get("teams", teamId);
    if (value === null) {
      throw new Error(
        `teams/${teamId} is missing. Run npm run seed:firebase first.`,
      );
    }
    return value as unknown as Team;
  }

  async getMatch(matchId: string): Promise<Match> {
    const value = await this.get("matches", matchId);
    if (value === null) throw new Error(`matches/${matchId} was not found.`);
    return value as unknown as Match;
  }

  async listMatches(trackedTeamId: string): Promise<Match[]> {
    const values = await this.list("matches");
    return values.filter(
      (value) => value.trackedTeamId === trackedTeamId,
    ) as unknown as Match[];
  }

  async updateMatchLifecycle(match: Match): Promise<void> {
    await this.put(
      "matches",
      match.id,
      match as unknown as Record<string, unknown>,
      match.createdAt,
    );
  }

  async countRateableParticipants(
    matchId: string,
    teamId: string,
  ): Promise<number> {
    const participants = await this.list(
      `matches/${encodeURIComponent(matchId)}/participants`,
    );
    return participants.filter(
      (participant) =>
        participant.teamId === teamId && participant.participated === true,
    ).length;
  }

  async hasTrackedTeamHeadCoach(
    matchId: string,
    teamId: string,
  ): Promise<boolean> {
    const assignment = await this.get(
      `matches/${encodeURIComponent(matchId)}/coachAssignments`,
      "head-coach",
    );
    return assignment?.teamId === teamId && assignment.role === "head-coach";
  }

  async finalizeMatchResult(matchId: string, now: Date): Promise<void> {
    const match = await this.getMatch(matchId);
    const collection = `matches/${encodeURIComponent(matchId)}/results`;
    const existing = await this.get(collection, "summary");
    if (existing !== null) {
      if (match.ratingState !== "rating_closed") {
        await this.updateMatchLifecycle({
          ...match,
          ratingState: "rating_closed",
          updatedAt: now.toISOString(),
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
    const [participants, coach, ballots] = await Promise.all([
      this.list(`matches/${encodeURIComponent(matchId)}/participants`),
      this.get(
        `matches/${encodeURIComponent(matchId)}/coachAssignments`,
        "head-coach",
      ),
      this.list(`matches/${encodeURIComponent(matchId)}/ballots`),
    ]);
    if (coach === null) throw new Error("Head coach assignment is missing.");
    const result = aggregateMatchResult({
      matchId,
      teamId: match.trackedTeamId,
      participants: participants as unknown as MatchParticipant[],
      coach: coach as unknown as CoachAssignment,
      ballots: ballots as unknown as Ballot[],
      generatedAt: now.toISOString(),
    });
    await this.create(
      collection,
      "summary",
      result as unknown as Record<string, unknown>,
    );
    await this.updateMatchLifecycle({
      ...match,
      ratingState: "rating_closed",
      updatedAt: now.toISOString(),
    });
  }

  async getSyncMetadata(teamId: string): Promise<FootballSyncMetadata | null> {
    return (await this.get(
      "footballSyncMetadata",
      teamId,
    )) as unknown as FootballSyncMetadata | null;
  }

  async setSyncMetadata(metadata: FootballSyncMetadata): Promise<void> {
    const existing = await this.get("footballSyncMetadata", metadata.teamId);
    if (existing === null) {
      await this.create(
        "footballSyncMetadata",
        metadata.teamId,
        metadata as unknown as Record<string, unknown>,
      );
      return;
    }
    await this.put(
      "footballSyncMetadata",
      metadata.teamId,
      metadata as unknown as Record<string, unknown>,
      typeof existing.createdAt === "string"
        ? existing.createdAt
        : metadata.updatedAt,
    );
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
    await this.put("teams", team.id, updated, team.createdAt);
    return updated;
  }

  upsertCompetitions(competitions: Competition[]): Promise<SyncWriteCounts> {
    return this.upsert("competitions", competitions);
  }

  upsertSeasons(seasons: Season[]): Promise<SyncWriteCounts> {
    return this.upsert("seasons", seasons);
  }

  upsertMatches(matches: Match[]): Promise<SyncWriteCounts> {
    return this.upsert("matches", matches, true);
  }

  upsertPlayers(players: Player[]): Promise<SyncWriteCounts> {
    return this.upsert("players", players);
  }

  upsertMatchParticipants(
    matchId: string,
    participants: MatchParticipant[],
  ): Promise<SyncWriteCounts> {
    return this.upsert(
      `matches/${encodeURIComponent(matchId)}/participants`,
      participants.map((participant) => ({
        ...participant,
        id: participant.playerId,
      })),
    );
  }

  upsertCoaches(coaches: Coach[]): Promise<SyncWriteCounts> {
    return this.upsert("coaches", coaches);
  }

  upsertCoachAssignment(
    matchId: string,
    assignment: CoachAssignment,
  ): Promise<SyncWriteCounts> {
    return this.upsert(
      `matches/${encodeURIComponent(matchId)}/coachAssignments`,
      [{ ...assignment, id: "head-coach" }],
    );
  }

  private async upsert(
    collection: string,
    values: Array<
      | Competition
      | Season
      | Match
      | Player
      | Coach
      | (MatchParticipant & { id: string })
      | (CoachAssignment & { id: string })
    >,
    preserveLifecycle = false,
  ): Promise<SyncWriteCounts> {
    const counts = { created: 0, updated: 0, unchanged: 0 };
    for (const value of values) {
      const existing = await this.get(collection, value.id);
      if (existing === null) {
        await this.create(
          collection,
          value.id,
          value as unknown as Record<string, unknown>,
        );
        counts.created += 1;
      } else {
        const candidate = preserveLifecycle
          ? preserveMatchLifecycle(existing, value as Match)
          : value;
        if (
          comparable(existing) ===
          comparable(candidate as unknown as Record<string, unknown>)
        )
          counts.unchanged += 1;
        else {
          await this.put(
            collection,
            value.id,
            { ...existing, ...candidate },
            typeof existing.createdAt === "string"
              ? existing.createdAt
              : value.createdAt,
          );
          counts.updated += 1;
        }
      }
    }
    return counts;
  }

  private async get(
    collection: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const response = await fetch(`${this.baseUrl}/${collection}/${id}`, {
      headers: { Authorization: "Bearer owner" },
    });
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Firestore read failed (${response.status}).`);
    const document = (await response.json()) as RestDocument;
    return { id, ...decodeFields(document.fields) };
  }

  private async list(collection: string): Promise<Record<string, unknown>[]> {
    const response = await fetch(`${this.baseUrl}/${collection}`, {
      headers: { Authorization: "Bearer owner" },
    });
    if (!response.ok)
      throw new Error(`Firestore list failed (${response.status}).`);
    const body = (await response.json()) as { documents?: RestDocument[] };
    return (body.documents ?? []).map((document) => ({
      id: document.name.split("/").at(-1),
      ...decodeFields(document.fields),
    }));
  }

  private async create(
    collection: string,
    id: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/${collection}?documentId=${encodeURIComponent(id)}`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ fields: encodeFields(withoutId(value)) }),
      },
    );
    if (!response.ok)
      throw new Error(`Firestore create failed (${response.status}).`);
  }

  private async put(
    collection: string,
    id: string,
    value: Record<string, unknown>,
    createdAt: string,
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${collection}/${id}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify({
        fields: encodeFields(withoutId({ ...value, createdAt })),
      }),
    });
    if (!response.ok)
      throw new Error(`Firestore update failed (${response.status}).`);
  }

  private get headers() {
    return {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    };
  }
}

function withoutId(value: Record<string, unknown>) {
  const document = { ...value };
  delete document.id;
  return document;
}

function preserveMatchLifecycle(
  existing: Record<string, unknown>,
  incoming: Match,
): Match {
  const ratingState =
    typeof existing.ratingState === "string"
      ? (existing.ratingState as Match["ratingState"])
      : incoming.ratingState;
  const status =
    typeof existing.status === "string"
      ? preserveMonotonicMatchStatus(
          existing.status as Match["status"],
          incoming.status,
          ratingState,
        )
      : incoming.status;
  return {
    ...incoming,
    createdAt:
      typeof existing.createdAt === "string"
        ? existing.createdAt
        : incoming.createdAt,
    ratingState,
    status,
    ...(typeof existing.lastProviderSyncAt === "string"
      ? { lastProviderSyncAt: existing.lastProviderSyncAt }
      : {}),
    ...(typeof existing.participantSyncedAt === "string"
      ? { participantSyncedAt: existing.participantSyncedAt }
      : {}),
    ...(typeof existing.ratingReadyAt === "string"
      ? { ratingReadyAt: existing.ratingReadyAt }
      : {}),
    ...(typeof existing.votingOpensAt === "string"
      ? { votingOpensAt: existing.votingOpensAt }
      : {}),
    ...(typeof existing.votingClosesAt === "string"
      ? { votingClosesAt: existing.votingClosesAt }
      : {}),
  };
}
