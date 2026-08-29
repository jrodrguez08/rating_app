import type {
  FixtureWindow,
  FootballDataProvider,
  ProviderCompetitionSeason,
  ProviderFixture,
  ProviderTeamIdentity,
  TeamLookup,
} from "@/domain/ports";

import { ProviderError } from "./errors";

const BASE_URL = "https://v3.football.api-sports.io";
type Fetcher = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) malformed(`${label} must be an object.`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) malformed(`${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    malformed(`${label} must be a non-empty string.`);
  }
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    malformed(`${label} must be a finite number.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === null || value === undefined
    ? undefined
    : string(value, label);
}

function nullableScore(value: unknown, label: string): number | null {
  return value === null ? null : number(value, label);
}

function utcTimestamp(value: unknown, label: string): string {
  const source = string(value, label);
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) malformed(`${label} is not a valid date.`);
  return date.toISOString();
}

function utcDate(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return utcTimestamp(`${string(value, label)}T00:00:00.000Z`, label);
}

function malformed(message: string): never {
  throw new ProviderError("malformed-response", `API-Football: ${message}`);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function mapApiFootballStatus(
  value: unknown,
): ProviderFixture["status"] {
  const status = string(value, "fixture.status.short");
  if (["TBD", "NS"].includes(status)) return "scheduled";
  if (["1H", "HT", "2H", "ET", "BT", "P"].includes(status)) return "live";
  if (["FT", "AET", "PEN"].includes(status)) return "finished";
  if (status === "PST") return "postponed";
  if (["SUSP", "INT"].includes(status)) return "suspended";
  if (status === "CANC") return "cancelled";
  if (["ABD", "AWD", "WO"].includes(status)) return "abandoned";
  return malformed(`unsupported fixture status ${status}.`);
}

export class ApiFootballAdapter implements FootballDataProvider {
  readonly name = "api-football";
  requestCount = 0;

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly log: (message: string) => void = () => undefined,
  ) {
    if (apiKey.trim() === "") {
      throw new ProviderError(
        "missing-api-key",
        "API_FOOTBALL_KEY is required for football synchronization.",
      );
    }
  }

  async resolveTeam(lookup: TeamLookup): Promise<ProviderTeamIdentity> {
    const response = await this.request("/teams", { search: lookup.shortName });
    const expectedNames = new Set([
      normalize(lookup.displayName),
      normalize(lookup.shortName),
      normalize(lookup.displayName.replace(/^club sport\s+/i, "")),
    ]);
    const matches = response
      .map((value) => {
        const item = record(value, "team response item");
        const team = record(item.team, "team response item.team");
        return {
          externalProviderId: String(number(team.id, "team.id")),
          name: string(team.name, "team.name"),
          countryName: string(team.country, "team.country"),
        };
      })
      .filter(
        (team) =>
          expectedNames.has(normalize(team.name)) &&
          normalize(team.countryName) === normalize(lookup.countryName),
      );

    if (matches.length === 0) {
      throw new ProviderError(
        "team-not-found",
        `No exact ${lookup.displayName} result was found in ${lookup.countryName}.`,
      );
    }
    if (matches.length > 1) {
      throw new ProviderError(
        "ambiguous-team",
        `Multiple exact provider teams matched ${lookup.displayName}; no mapping was persisted.`,
      );
    }
    return matches[0];
  }

  async getCompetitionSeasons(
    externalTeamId: string,
  ): Promise<ProviderCompetitionSeason[]> {
    const response = await this.request("/leagues", { team: externalTeamId });
    return response.flatMap((value) => {
      const item = record(value, "league response item");
      const league = record(item.league, "league response item.league");
      const country = record(item.country, "league response item.country");
      const type = string(league.type, "league.type").toLowerCase();
      if (type !== "league" && type !== "cup") {
        return malformed(`unsupported competition type ${type}.`);
      }
      return array(item.seasons, "league response item.seasons").map(
        (value) => {
          const season = record(value, "season");
          return {
            externalCompetitionId: String(number(league.id, "league.id")),
            competitionName: string(league.name, "league.name"),
            countryName: string(country.name, "country.name"),
            ...(optionalString(country.code, "country.code") === undefined
              ? {}
              : { countryCode: optionalString(country.code, "country.code") }),
            type,
            providerSeason: number(season.year, "season.year"),
            ...(utcDate(season.start, "season.start") === undefined
              ? {}
              : { startsAt: utcDate(season.start, "season.start") }),
            ...(utcDate(season.end, "season.end") === undefined
              ? {}
              : { endsAt: utcDate(season.end, "season.end") }),
            isCurrent: season.current === true,
          } satisfies ProviderCompetitionSeason;
        },
      );
    });
  }

  async getFixtures(
    externalTeamId: string,
    window: FixtureWindow,
  ): Promise<ProviderFixture[]> {
    const response = await this.request("/fixtures", {
      team: externalTeamId,
      from: window.from,
      to: window.to,
      timezone: "UTC",
    });
    return response.map((value) => {
      const item = record(value, "fixture response item");
      const fixture = record(item.fixture, "fixture");
      const league = record(item.league, "fixture.league");
      const teams = record(item.teams, "fixture.teams");
      const goals = record(item.goals, "fixture.goals");
      return {
        externalFixtureId: String(number(fixture.id, "fixture.id")),
        externalCompetitionId: String(number(league.id, "fixture.league.id")),
        providerSeason: number(league.season, "fixture.league.season"),
        kickoffAt: utcTimestamp(fixture.date, "fixture.date"),
        status: mapApiFootballStatus(
          record(fixture.status, "fixture.status").short,
        ),
        homeTeam: this.parseFixtureTeam(teams.home, "fixture.teams.home"),
        awayTeam: this.parseFixtureTeam(teams.away, "fixture.teams.away"),
        score: {
          home: nullableScore(goals.home, "fixture.goals.home"),
          away: nullableScore(goals.away, "fixture.goals.away"),
        },
      };
    });
  }

  private parseFixtureTeam(value: unknown, label: string) {
    const team = record(value, label);
    const logoUrl = optionalString(team.logo, `${label}.logo`);
    return {
      externalProviderId: String(number(team.id, `${label}.id`)),
      name: string(team.name, `${label}.name`),
      ...(logoUrl === undefined ? {} : { logoUrl }),
    };
  }

  private async request(
    path: string,
    query: Record<string, string>,
  ): Promise<unknown[]> {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    this.requestCount += 1;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { "x-apisports-key": this.apiKey },
      });
    } catch (error) {
      throw new ProviderError(
        "request-failed",
        `API-Football request to ${path} failed.`,
        { cause: error },
      );
    }
    const remaining = response.headers.get("x-ratelimit-requests-remaining");
    if (remaining !== null)
      this.log(`API-Football requests remaining: ${remaining}`);
    if (response.status === 429) {
      throw new ProviderError(
        "rate-limited",
        "API-Football rate limit exceeded.",
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        "request-failed",
        `API-Football request to ${path} returned HTTP ${response.status}.`,
      );
    }
    const body: unknown = await response.json();
    const envelope = record(body, "response");
    const errors = envelope.errors;
    if (
      (Array.isArray(errors) && errors.length > 0) ||
      (isRecord(errors) && Object.keys(errors).length > 0)
    ) {
      throw new ProviderError(
        "request-failed",
        `API-Football returned an error for ${path}.`,
      );
    }
    return array(envelope.response, "response.response");
  }
}
