import { trackedMatchId } from "@/application/match-identity";
import { resolveClub } from "@/config/club";

export const MAX_WRAPPED_FIXTURES = 512;
const MAX_EDITIONS = 32;

type Disposition =
  | { disposition: "expected" }
  | { disposition: "excluded" | "cancelled"; reason: string }
  | { disposition: "replaced"; reason: string; replacementMatchId: string };

export type WrappedFixture = {
  matchId: string;
  providerFixtureId?: string;
  stage: string;
  evidence: string;
} & Disposition;

export interface WrappedTournament {
  key: string;
  competitionId: string;
  provider: string;
  providerCompetitionId: string;
  seasonId: string;
  providerSeason: number;
  seasonStartYear: number;
  seasonEndYear: number;
  edition: "apertura" | "clausura";
  editionYear: number;
  stages: string[];
  review: { source: string; reviewedBy: string; reviewedAt: string };
  completion?: { source: string; completedAt: string };
  fixtures: WrappedFixture[];
}

export interface WrappedLedger {
  clubSlug: string;
  teamId: string;
  tournaments: WrappedTournament[];
}

export function parseWrappedLedger(value: unknown): WrappedLedger {
  const input = record(value, "ledger");
  if (input.version !== 1) invalid("ledger.version", "expected 1");
  const club = resolveClub(identifier(input.clubSlug, "ledger.clubSlug"));
  if (!club || input.teamId !== club.teamId)
    invalid("ledger.teamId", "must match a registered club");

  const tournaments = list(input.tournaments, "tournaments", MAX_EDITIONS).map(
    (value, index) =>
      parseTournament(value, club.teamId, "tournaments[" + index + "]"),
  );
  const keys = new Set<string>();
  const providerEditions = new Set<string>();
  const providerSeasons = new Map<string, string>();
  const internalSeasons = new Map<string, string>();
  const matches = new Set<string>();
  const fixtures = new Set<string>();
  for (const tournament of tournaments) {
    if (keys.has(tournament.key))
      invalid(tournament.key, "duplicate competition/year/edition definition");
    keys.add(tournament.key);
    const providerCompetition =
      tournament.provider + ":" + tournament.providerCompetitionId;
    const providerEdition = [
      providerCompetition,
      tournament.editionYear,
      tournament.edition,
    ].join(":");
    if (providerEditions.has(providerEdition))
      invalid(
        tournament.key,
        "provider competition/year/edition already defined",
      );
    providerEditions.add(providerEdition);
    const providerSeason =
      providerCompetition + ":" + tournament.providerSeason;
    const binding = [tournament.competitionId, tournament.seasonId].join(":");
    const previous = providerSeasons.get(providerSeason);
    if (previous !== undefined && previous !== binding)
      invalid(tournament.key, "conflicting provider season binding");
    providerSeasons.set(providerSeason, binding);
    const previousProvider = internalSeasons.get(tournament.seasonId);
    if (previousProvider !== undefined && previousProvider !== providerSeason)
      invalid(tournament.key, "conflicting internal season binding");
    internalSeasons.set(tournament.seasonId, providerSeason);
    for (const fixture of tournament.fixtures) {
      if (matches.has(fixture.matchId))
        invalid(
          fixture.matchId,
          "Match assigned more than once in this Team ledger",
        );
      matches.add(fixture.matchId);
      if (fixture.providerFixtureId === undefined) continue;
      const key = tournament.provider + ":" + fixture.providerFixtureId;
      if (fixtures.has(key))
        invalid(
          fixture.matchId,
          "provider fixture assigned more than once in this Team ledger",
        );
      fixtures.add(key);
    }
  }
  return { clubSlug: club.slug, teamId: club.teamId, tournaments };
}

function parseTournament(
  value: unknown,
  teamId: string,
  field: string,
): WrappedTournament {
  const input = record(value, field);
  const competitionId = identifier(
    input.competitionId,
    field + ".competitionId",
  );
  const provider = identifier(input.provider, field + ".provider");
  const edition = input.edition;
  if (edition !== "apertura" && edition !== "clausura")
    invalid(field + ".edition", "expected apertura or clausura");
  const editionYear = year(input.editionYear, field + ".editionYear");
  const seasonStartYear = year(
    input.seasonStartYear,
    field + ".seasonStartYear",
  );
  const seasonEndYear = year(input.seasonEndYear, field + ".seasonEndYear");
  if (
    seasonEndYear < seasonStartYear ||
    seasonEndYear > seasonStartYear + 1 ||
    editionYear < seasonStartYear ||
    editionYear > seasonEndYear
  )
    invalid(
      field,
      "edition year must belong to the reviewed one- or two-year season span",
    );
  const key = [competitionId, editionYear, edition].join(":");
  const stages = list(input.stages, field + ".stages", 16).map((stage) =>
    identifier(stage, field + ".stages"),
  );
  if (new Set(stages).size !== stages.length)
    invalid(field + ".stages", "duplicate stage");

  const review = record(input.review, field + ".review");
  const reviewedAt = instant(review.reviewedAt, field + ".review.reviewedAt");
  let completion: WrappedTournament["completion"];
  if (input.completion !== undefined) {
    const evidence = record(input.completion, field + ".completion");
    const completedAt = instant(
      evidence.completedAt,
      field + ".completion.completedAt",
    );
    if (completedAt > reviewedAt)
      invalid(field + ".completion", "completion postdates review");
    completion = {
      source: note(evidence.source, field + ".completion.source"),
      completedAt,
    };
  }

  const fixtures = list(
    input.fixtures,
    field + ".fixtures",
    MAX_WRAPPED_FIXTURES,
  ).map((value, index) =>
    parseFixture(value, field + ".fixtures[" + index + "]", stages),
  );
  const byId = new Map(fixtures.map((fixture) => [fixture.matchId, fixture]));
  const replacements = new Set<string>();
  for (const fixture of fixtures) {
    if (
      fixture.providerFixtureId !== undefined &&
      trackedMatchId(provider, fixture.providerFixtureId, teamId) !==
        fixture.matchId
    )
      invalid(
        fixture.matchId,
        "provider fixture does not identify this tracked Team's Match",
      );
    if (fixture.disposition !== "replaced") continue;
    const target = byId.get(fixture.replacementMatchId);
    if (
      target?.disposition !== "expected" ||
      target.stage !== fixture.stage ||
      replacements.has(target.matchId)
    )
      invalid(
        fixture.matchId,
        "replacement must reference a unique expected Match in the same stage",
      );
    replacements.add(target.matchId);
  }

  return {
    key,
    competitionId,
    provider,
    edition,
    editionYear,
    seasonStartYear,
    seasonEndYear,
    seasonId: identifier(input.seasonId, field + ".seasonId"),
    providerCompetitionId: identifier(
      input.providerCompetitionId,
      field + ".providerCompetitionId",
    ),
    providerSeason: year(input.providerSeason, field + ".providerSeason"),
    stages: stages.sort(),
    review: {
      reviewedAt,
      source: note(review.source, field + ".review.source"),
      reviewedBy: identifier(review.reviewedBy, field + ".review.reviewedBy"),
    },
    ...(completion && { completion }),
    fixtures: fixtures.sort((a, b) =>
      a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0,
    ),
  };
}

function parseFixture(
  value: unknown,
  field: string,
  stages: string[],
): WrappedFixture {
  const input = record(value, field);
  const stage = identifier(input.stage, field + ".stage");
  if (!stages.includes(stage))
    invalid(field + ".stage", "stage is outside the approved scope");
  const base = {
    matchId: identifier(input.matchId, field + ".matchId"),
    stage,
    evidence: note(input.evidence, field + ".evidence"),
    ...(input.providerFixtureId === undefined
      ? {}
      : {
          providerFixtureId: identifier(
            input.providerFixtureId,
            field + ".providerFixtureId",
          ),
        }),
  };
  if (
    input.disposition !== "replaced" &&
    input.replacementMatchId !== undefined
  )
    invalid(
      field + ".replacementMatchId",
      "only replaced fixtures can link to a replacement",
    );
  switch (input.disposition) {
    case "expected":
      if (input.reason !== undefined)
        invalid(field + ".reason", "expected fixtures cannot be excluded");
      return { ...base, disposition: input.disposition };
    case "excluded":
    case "cancelled":
      return {
        ...base,
        disposition: input.disposition,
        reason: note(input.reason, field + ".reason"),
      };
    case "replaced":
      return {
        ...base,
        disposition: input.disposition,
        reason: note(input.reason, field + ".reason"),
        replacementMatchId: identifier(
          input.replacementMatchId,
          field + ".replacementMatchId",
        ),
      };
    default:
      return invalid(field + ".disposition", "unknown fixture disposition");
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(field, "expected an object");
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max)
    invalid(field, "expected 1 to " + max + " entries");
  return value;
}

function identifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
  )
    invalid(field, "expected a safe identifier");
  return value;
}

function note(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024)
    invalid(
      field,
      "expected nonempty evidence or rationale (up to 1024 characters)",
    );
  return value.trim();
}

function year(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1900 ||
    value > 9999
  )
    invalid(field, "expected a four-digit year");
  return value;
}

function instant(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field, "expected a UTC timestamp");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
    invalid(field, "expected YYYY-MM-DDTHH:mm:ss.sssZ");
  return value;
}

function invalid(field: string, message: string): never {
  throw new Error(field + ": " + message);
}
