import type { Competition, Match, Season, Team } from "@/domain/models";
import type { FootballSyncStore, SyncWriteCounts } from "@/domain/ports";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
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
  if (key === "createdAt" || key === "updatedAt" || key === "kickoffAt") {
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
  return JSON.stringify(copy);
}

export class EmulatorFootballSyncStore implements FootballSyncStore {
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
    return this.upsert("matches", matches);
  }

  private async upsert(
    collection: string,
    values: Array<Competition | Season | Match>,
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
      } else if (
        comparable(existing) ===
        comparable(value as unknown as Record<string, unknown>)
      ) {
        counts.unchanged += 1;
      } else {
        await this.put(
          collection,
          value.id,
          { ...existing, ...value },
          typeof existing.createdAt === "string"
            ? existing.createdAt
            : value.createdAt,
        );
        counts.updated += 1;
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
