import type { MatchGoalEvent, PlayerPosition } from "@/domain/models";
import type {
  FixtureWindow,
  FootballDataProvider,
  ProviderMatchContext,
  ProviderMatchParticipant,
  ProviderSquadPlayer,
  ProviderCompetitionSeason,
  ProviderFixture,
  ProviderTeamIdentity,
  TeamLookup,
} from "@/domain/ports";
import { isPlayerPhotoUrl } from "@/config/player-photos";

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

function optionalNumber(value: unknown, label: string): number | undefined {
  return value === null || value === undefined
    ? undefined
    : number(value, label);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "boolean") malformed(`${label} must be a boolean.`);
  return value;
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

function cloneMatchContext(
  context: ProviderMatchContext | undefined,
): ProviderMatchContext | undefined {
  return context === undefined
    ? undefined
    : {
        participants: context.participants.map((participant) => ({
          ...participant,
        })),
        headCoach: { ...context.headCoach },
      };
}

function strongestMatchContext(
  observed: ProviderMatchContext | null,
  baseline: ProviderMatchContext | undefined,
): ProviderMatchContext | undefined {
  const persisted = cloneMatchContext(baseline);
  if (observed === null) return persisted;
  if (
    persisted !== undefined &&
    observed.participants.length < persisted.participants.length
  ) {
    return persisted;
  }
  return observed;
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

export function mapApiFootballPlayerPosition(
  value: unknown,
): PlayerPosition | undefined {
  if (typeof value !== "string") return undefined;
  const positions: Record<string, PlayerPosition> = {
    goalkeeper: "goalkeeper",
    g: "goalkeeper",
    defender: "defender",
    d: "defender",
    midfielder: "midfielder",
    m: "midfielder",
    attacker: "attacker",
    f: "attacker",
  };
  return positions[value.trim().toLowerCase()];
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
      normalize(lookup.displayName.replace(/^club sport\s+/i, "CS ")),
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
    competitionSeasons: ProviderCompetitionSeason[],
  ): Promise<ProviderFixture[]> {
    const seasons = [
      ...new Set(
        competitionSeasons
          .filter((season) => overlapsWindow(season, window))
          .map((season) => season.providerSeason),
      ),
    ];
    const response: unknown[] = [];
    for (const season of seasons) {
      response.push(
        ...(await this.request("/fixtures", {
          team: externalTeamId,
          season: String(season),
          from: window.from,
          to: window.to,
          timezone: "UTC",
        })),
      );
    }
    return response.map((value) => this.parseFixture(value));
  }

  async getFixture(externalFixtureId: string): Promise<ProviderFixture> {
    const response = await this.request("/fixtures", {
      id: externalFixtureId,
      timezone: "UTC",
    });
    if (response.length === 0) {
      throw new ProviderError(
        "fixture-not-found",
        `Fixture ${externalFixtureId} was not found.`,
      );
    }
    if (response.length !== 1) {
      return malformed(
        `fixture ${externalFixtureId} returned multiple records.`,
      );
    }
    return this.parseFixture(response[0]);
  }

  async getMatchContext(
    externalFixtureId: string,
    externalTeamId: string,
    baseline?: ProviderMatchContext,
  ): Promise<ProviderMatchContext> {
    const [lineups, players, events] = await Promise.all([
      this.request("/fixtures/lineups", { fixture: externalFixtureId }),
      this.request("/fixtures/players", { fixture: externalFixtureId }),
      this.request("/fixtures/events", { fixture: externalFixtureId }),
    ]);
    const observed = this.parseLineupContext(
      lineups,
      externalFixtureId,
      externalTeamId,
    );
    const context = strongestMatchContext(observed, baseline);
    if (context === undefined) {
      throw new ProviderError(
        "lineup-unavailable",
        `No usable lineup has been observed for fixture ${externalFixtureId}; retry after provider cache propagation.`,
      );
    }
    if (context.headCoach.externalTeamId !== externalTeamId) {
      throw new ProviderError(
        "tracked-team-missing",
        `Persisted context does not belong to tracked Team ${externalTeamId}.`,
      );
    }
    const participants = new Map(
      context.participants.map((participant) => [
        participant.externalPlayerId,
        { ...participant },
      ]),
    );
    this.reconcilePlayerStatistics(participants, players, externalTeamId);
    this.reconcileSubstitutions(participants, events, externalTeamId);
    return {
      participants: [...participants.values()],
      headCoach: context.headCoach,
    };
  }

  async getLineupContext(
    externalFixtureId: string,
    externalTeamId: string,
  ): Promise<ProviderMatchContext | null> {
    return this.parseLineupContext(
      await this.request("/fixtures/lineups", {
        fixture: externalFixtureId,
      }),
      externalFixtureId,
      externalTeamId,
    );
  }

  async getSquad(externalTeamId: string): Promise<ProviderSquadPlayer[]> {
    const response = await this.request("/players/squads", {
      team: externalTeamId,
    });
    if (response.length !== 1) {
      return malformed(
        `squad Team ${externalTeamId} returned ${response.length} records.`,
      );
    }
    const item = record(response[0], "squad response item");
    const team = record(item.team, "squad response item.team");
    if (String(number(team.id, "squad team.id")) !== externalTeamId) {
      return malformed(`squad response does not match Team ${externalTeamId}.`);
    }
    const players = new Map<string, ProviderSquadPlayer>();
    for (const value of array(item.players, "squad response item.players")) {
      const player = parseSquadPlayer(value);
      if (player !== null && !players.has(player.externalPlayerId)) {
        players.set(player.externalPlayerId, player);
      }
    }
    return [...players.values()];
  }

  private addLineupPlayers(
    participants: Map<string, ProviderMatchParticipant>,
    value: unknown,
    squadRole: ProviderMatchParticipant["squadRole"],
    externalTeamId: string,
  ) {
    for (const entryValue of array(value, `lineup.${squadRole}`)) {
      const entry = record(entryValue, `lineup.${squadRole} entry`);
      const player = record(entry.player, `lineup.${squadRole}.player`);
      const externalPlayerId = String(
        number(player.id, `lineup.${squadRole}.player.id`),
      );
      if (participants.has(externalPlayerId)) {
        return malformed(
          `player ${externalPlayerId} appears twice in the lineup.`,
        );
      }
      const shirtNumber = optionalNumber(
        player.number,
        `lineup.${squadRole}.player.number`,
      );
      const position = mapApiFootballPlayerPosition(player.pos);
      participants.set(externalPlayerId, {
        externalTeamId,
        externalPlayerId,
        name: string(player.name, `lineup.${squadRole}.player.name`),
        ...(shirtNumber === undefined ? {} : { shirtNumber }),
        ...(position === undefined ? {} : { position }),
        squadRole,
        participated: squadRole === "starter",
      });
    }
  }

  private parseLineupContext(
    lineups: unknown[],
    externalFixtureId: string,
    externalTeamId: string,
  ): ProviderMatchContext | null {
    if (lineups.length === 0) return null;
    const trackedLineups = lineups.filter((value) => {
      const lineup = record(value, "lineup");
      const team = record(lineup.team, "lineup.team");
      return String(number(team.id, "lineup.team.id")) === externalTeamId;
    });
    if (trackedLineups.length === 0) {
      throw new ProviderError(
        "tracked-team-missing",
        `Tracked Team ${externalTeamId} is missing from fixture ${externalFixtureId} lineups.`,
      );
    }
    if (trackedLineups.length > 1) {
      throw new ProviderError(
        "ambiguous-coach",
        `Fixture ${externalFixtureId} contains multiple lineups for tracked Team ${externalTeamId}.`,
      );
    }
    const lineup = record(trackedLineups[0], "tracked lineup");
    const participants = new Map<string, ProviderMatchParticipant>();
    this.addLineupPlayers(
      participants,
      lineup.startXI,
      "starter",
      externalTeamId,
    );
    this.addLineupPlayers(
      participants,
      lineup.substitutes,
      "substitute",
      externalTeamId,
    );
    const starterCount = [...participants.values()].filter(
      (participant) => participant.squadRole === "starter",
    ).length;
    const substituteCount = participants.size - starterCount;
    if (starterCount !== 11 || substituteCount === 0) {
      throw new ProviderError(
        "lineup-unavailable",
        `Tracked Team lineup for fixture ${externalFixtureId} is incomplete (${starterCount} starters, ${substituteCount} substitutes).`,
      );
    }
    if (lineup.coach === null || lineup.coach === undefined) {
      throw new ProviderError(
        "coach-missing",
        `Head coach is not published for tracked Team ${externalTeamId}.`,
      );
    }
    const coach = record(lineup.coach, "lineup.coach");
    const photoUrl = optionalString(coach.photo, "lineup.coach.photo");
    return {
      participants: [...participants.values()],
      headCoach: {
        externalTeamId,
        externalCoachId: String(number(coach.id, "lineup.coach.id")),
        name: string(coach.name, "lineup.coach.name"),
        ...(photoUrl === undefined ? {} : { photoUrl }),
      },
    };
  }

  private reconcilePlayerStatistics(
    participants: Map<string, ProviderMatchParticipant>,
    value: unknown,
    externalTeamId: string,
  ) {
    if (value === null || value === undefined) return;
    const teams = array(value, "fixture.players");
    const tracked = teams.filter((teamValue) => {
      const teamEntry = record(teamValue, "fixture.players team");
      return (
        String(
          number(
            record(teamEntry.team, "fixture.players.team").id,
            "fixture.players.team.id",
          ),
        ) === externalTeamId
      );
    });
    if (tracked.length > 1)
      malformed("fixture.players repeats the tracked Team.");
    if (tracked.length === 0) return;
    const teamEntry = record(tracked[0], "tracked fixture.players team");
    for (const value of array(teamEntry.players, "fixture.players.players")) {
      const entry = record(value, "fixture player");
      const identity = record(entry.player, "fixture player.player");
      const id = String(number(identity.id, "fixture player.player.id"));
      const participant = participants.get(id);
      if (participant === undefined) continue;
      const statistics = array(entry.statistics, "fixture player.statistics");
      if (statistics.length === 0) continue;
      const games = record(
        record(statistics[0], "fixture player statistic").games,
        "fixture player statistic.games",
      );
      const minutes = optionalNumber(games.minutes, "games.minutes");
      const position = mapApiFootballPlayerPosition(games.position);
      const captain = optionalBoolean(games.captain, "games.captain");
      if (minutes !== undefined && minutes > 0) participant.participated = true;
      if (position !== undefined) participant.position = position;
      if (captain !== undefined) participant.captain = captain;
    }
  }

  private reconcileSubstitutions(
    participants: Map<string, ProviderMatchParticipant>,
    value: unknown,
    externalTeamId: string,
  ) {
    if (value === null || value === undefined) return;
    for (const eventValue of array(value, "fixture.events")) {
      const event = record(eventValue, "fixture event");
      if (String(event.type).toLowerCase() !== "subst") continue;
      const team = record(event.team, "substitution.team");
      if (String(number(team.id, "substitution.team.id")) !== externalTeamId)
        continue;
      const time = record(event.time, "substitution.time");
      const elapsed = optionalNumber(time.elapsed, "substitution.time.elapsed");
      const extra = optionalNumber(time.extra, "substitution.time.extra") ?? 0;
      const minute = elapsed === undefined ? undefined : elapsed + extra;
      const outgoing = record(event.player, "substitution.player");
      const incoming = record(event.assist, "substitution.assist");
      const outgoingId = String(number(outgoing.id, "substitution.player.id"));
      const incomingId = String(number(incoming.id, "substitution.assist.id"));
      const outgoingParticipant = participants.get(outgoingId);
      const incomingParticipant = participants.get(incomingId);
      if (
        outgoingParticipant === undefined ||
        incomingParticipant === undefined
      ) {
        malformed(
          `substitution references player outside tracked Team lineup (${outgoingId}/${incomingId}).`,
        );
      }
      incomingParticipant.participated = true;
      if (minute !== undefined) {
        outgoingParticipant.exitedAtMinute ??= minute;
        incomingParticipant.enteredAtMinute ??= minute;
      }
    }
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

  private parseFixture(value: unknown): ProviderFixture {
    const item = record(value, "fixture response item");
    const fixture = record(item.fixture, "fixture");
    const league = record(item.league, "fixture.league");
    const teams = record(item.teams, "fixture.teams");
    const goals = record(item.goals, "fixture.goals");
    const status = record(fixture.status, "fixture.status");
    const elapsedMinute = optionalNumber(
      status.elapsed,
      "fixture.status.elapsed",
    );
    return {
      externalFixtureId: String(number(fixture.id, "fixture.id")),
      externalCompetitionId: String(number(league.id, "fixture.league.id")),
      providerSeason: number(league.season, "fixture.league.season"),
      kickoffAt: utcTimestamp(fixture.date, "fixture.date"),
      status: mapApiFootballStatus(status.short),
      homeTeam: this.parseFixtureTeam(teams.home, "fixture.teams.home"),
      awayTeam: this.parseFixtureTeam(teams.away, "fixture.teams.away"),
      score: {
        home: nullableScore(goals.home, "fixture.goals.home"),
        away: nullableScore(goals.away, "fixture.goals.away"),
      },
      ...(elapsedMinute === undefined ? {} : { elapsedMinute }),
      ...(Array.isArray(item.events)
        ? { goalEvents: parseGoalEvents(item.events) }
        : {}),
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

function parseSquadPlayer(value: unknown): ProviderSquadPlayer | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "number" ||
    !Number.isInteger(value.id) ||
    value.id <= 0 ||
    typeof value.name !== "string" ||
    value.name.trim() === ""
  ) {
    return null;
  }
  const position = mapApiFootballPlayerPosition(value.position);
  const photoUrl = normalizePlayerPhotoUrl(value.photo);
  return {
    externalPlayerId: String(value.id),
    name: value.name,
    ...(position === undefined ? {} : { position }),
    ...(photoUrl === undefined ? {} : { photoUrl }),
  };
}

function normalizePlayerPhotoUrl(value: unknown): string | undefined {
  return typeof value === "string" && isPlayerPhotoUrl(value)
    ? new URL(value).href
    : undefined;
}

function parseGoalEvents(value: unknown[]): MatchGoalEvent[] {
  return value
    .flatMap((eventValue): MatchGoalEvent[] => {
      if (
        !isRecord(eventValue) ||
        String(eventValue.type).toLowerCase() !== "goal"
      ) {
        return [];
      }
      const team = eventValue.team;
      const player = eventValue.player;
      const time = eventValue.time;
      if (!isRecord(team) || !isRecord(player) || !isRecord(time)) return [];
      if (
        typeof team.id !== "number" ||
        typeof player.id !== "number" ||
        typeof player.name !== "string" ||
        player.name.trim() === "" ||
        typeof time.elapsed !== "number" ||
        !Number.isFinite(time.elapsed)
      ) {
        return [];
      }
      const extra =
        typeof time.extra === "number" && Number.isFinite(time.extra)
          ? time.extra
          : undefined;
      const detail =
        typeof eventValue.detail === "string"
          ? eventValue.detail.toLowerCase()
          : "";
      const kind: MatchGoalEvent["kind"] = detail.includes("own goal")
        ? "own_goal"
        : detail.includes("penalty")
          ? "penalty"
          : detail.includes("normal goal")
            ? "normal"
            : "other";
      return [
        {
          externalTeamId: String(team.id),
          externalPlayerId: String(player.id),
          scorerName: player.name,
          elapsed: time.elapsed,
          ...(extra === undefined ? {} : { extra }),
          kind,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.elapsed - right.elapsed || (left.extra ?? 0) - (right.extra ?? 0),
    );
}

function overlapsWindow(
  season: ProviderCompetitionSeason,
  window: FixtureWindow,
): boolean {
  const from = `${window.from}T00:00:00.000Z`;
  const to = `${window.to}T23:59:59.999Z`;
  return (
    (season.startsAt === undefined || season.startsAt <= to) &&
    (season.endsAt === undefined || season.endsAt >= from)
  );
}
