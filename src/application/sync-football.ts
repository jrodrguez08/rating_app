import { createHash } from "node:crypto";

import type { Competition, Match, Season, Team } from "@/domain/models";
import type {
  FixtureWindow,
  FootballDataProvider,
  FootballSyncStore,
  ProviderCompetitionSeason,
  SyncWriteCounts,
} from "@/domain/ports";

export interface FootballSyncSummary {
  team: { id: string; externalProviderId: string; resolved: boolean };
  competitions: SyncWriteCounts;
  seasons: SyncWriteCounts;
  matches: SyncWriteCounts;
  fixtureCount: number;
  window: FixtureWindow;
  apiRequests: number;
}

export interface FootballSyncOptions {
  now?: Date;
  recentDays?: number;
  upcomingDays?: number;
}

function stableId(
  kind: "competition" | "season" | "match",
  provider: string,
  externalIdentity: string,
): string {
  const digest = createHash("sha256")
    .update(`${provider}:${kind}:${externalIdentity}`)
    .digest("hex")
    .slice(0, 24);
  return `${kind}-${digest}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildWindow(
  now: Date,
  recentDays: number,
  upcomingDays: number,
): FixtureWindow {
  const day = 86_400_000;
  return {
    from: dateOnly(new Date(now.getTime() - recentDays * day)),
    to: dateOnly(new Date(now.getTime() + upcomingDays * day)),
  };
}

function seasonKey(externalCompetitionId: string, providerSeason: number) {
  return `${externalCompetitionId}:${providerSeason}`;
}

export async function syncFootballData(
  initialTeam: Team,
  provider: FootballDataProvider,
  store: FootballSyncStore,
  options: FootballSyncOptions = {},
): Promise<FootballSyncSummary> {
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();
  const window = buildWindow(
    now,
    options.recentDays ?? 120,
    options.upcomingDays ?? 60,
  );
  let team = initialTeam;
  let resolved = false;
  let resolvedExternalProviderId: string | undefined;

  if (team.externalProviderId === undefined) {
    const identity = await provider.resolveTeam({
      displayName: team.displayName,
      shortName: team.shortName,
      countryName: team.countryName,
    });
    resolvedExternalProviderId = identity.externalProviderId;
    resolved = true;
  }

  const externalTeamId = team.externalProviderId ?? resolvedExternalProviderId;
  if (externalTeamId === undefined) {
    throw new Error("Team provider mapping was not established.");
  }

  const availableSeasons = await provider.getCompetitionSeasons(externalTeamId);
  const fixtures = await provider.getFixtures(
    externalTeamId,
    window,
    availableSeasons,
  );
  const seasonMetadata = new Map(
    availableSeasons.map((season) => [
      seasonKey(season.externalCompetitionId, season.providerSeason),
      season,
    ]),
  );
  const relevantKeys = new Set(
    fixtures.map((fixture) =>
      seasonKey(fixture.externalCompetitionId, fixture.providerSeason),
    ),
  );
  const relevantSeasons = [...relevantKeys].map((key) => {
    const metadata = seasonMetadata.get(key);
    if (metadata === undefined) {
      throw new Error(
        `Competition/season metadata is missing for fixture ${key}.`,
      );
    }
    return metadata;
  });

  const competitionsByExternalId = new Map<string, Competition>();
  const seasonsByKey = new Map<string, Season>();
  for (const metadata of relevantSeasons) {
    const competitionId = stableId(
      "competition",
      provider.name,
      metadata.externalCompetitionId,
    );
    competitionsByExternalId.set(metadata.externalCompetitionId, {
      id: competitionId,
      name: metadata.competitionName,
      countryName: metadata.countryName,
      ...(metadata.countryCode === undefined
        ? {}
        : { countryCode: metadata.countryCode }),
      type: metadata.type,
      externalProvider: provider.name,
      externalProviderId: metadata.externalCompetitionId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    seasonsByKey.set(
      seasonKey(metadata.externalCompetitionId, metadata.providerSeason),
      toSeason(metadata, competitionId, provider.name, timestamp),
    );
  }

  const matches = fixtures.map((fixture): Match => {
    const competition = competitionsByExternalId.get(
      fixture.externalCompetitionId,
    );
    const season = seasonsByKey.get(
      seasonKey(fixture.externalCompetitionId, fixture.providerSeason),
    );
    if (competition === undefined || season === undefined) {
      throw new Error(
        `Could not map fixture ${fixture.externalFixtureId} to a competition season.`,
      );
    }
    if (
      fixture.homeTeam.externalProviderId !== externalTeamId &&
      fixture.awayTeam.externalProviderId !== externalTeamId
    ) {
      throw new Error(
        `Fixture ${fixture.externalFixtureId} does not contain the tracked Team.`,
      );
    }
    return {
      id: stableId("match", provider.name, fixture.externalFixtureId),
      trackedTeamId: team.id,
      trackedTeamExternalProviderId: externalTeamId,
      competitionId: competition.id,
      seasonId: season.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      kickoffAt: fixture.kickoffAt,
      status: fixture.status,
      ratingState: "not_ready",
      score: fixture.score,
      ...(fixture.elapsedMinute === undefined
        ? {}
        : { elapsedMinute: fixture.elapsedMinute }),
      ...(fixture.goalEvents === undefined
        ? {}
        : { goalEvents: fixture.goalEvents }),
      externalProvider: provider.name,
      externalProviderFixtureId: fixture.externalFixtureId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

  if (resolvedExternalProviderId !== undefined) {
    team = await store.updateTeamProviderId(team, resolvedExternalProviderId);
  }
  const competitions = await store.upsertCompetitions([
    ...competitionsByExternalId.values(),
  ]);
  const seasons = await store.upsertSeasons([...seasonsByKey.values()]);
  const matchCounts = await store.upsertMatches(matches);

  return {
    team: { id: team.id, externalProviderId: externalTeamId, resolved },
    competitions,
    seasons,
    matches: matchCounts,
    fixtureCount: matches.length,
    window,
    apiRequests: provider.requestCount,
  };
}

function toSeason(
  metadata: ProviderCompetitionSeason,
  competitionId: string,
  provider: string,
  timestamp: string,
): Season {
  return {
    id: stableId(
      "season",
      provider,
      `${metadata.externalCompetitionId}:${metadata.providerSeason}`,
    ),
    competitionId,
    name: String(metadata.providerSeason),
    externalProvider: provider,
    externalProviderSeason: metadata.providerSeason,
    ...(metadata.startsAt === undefined ? {} : { startsAt: metadata.startsAt }),
    ...(metadata.endsAt === undefined ? {} : { endsAt: metadata.endsAt }),
    isCurrent: metadata.isCurrent,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
