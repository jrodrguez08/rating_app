import { trackedMatchId } from "@/application/match-identity";
import type { WrappedTournament } from "@/application/wrapped-ledger";
import { clubs, type ClubSlug } from "@/config/club";
import type {
  Competition,
  Match,
  MatchResult,
  Season,
  Team,
} from "@/domain/models";

export const asOf = new Date("2025-07-01T00:00:00.000Z");
const start = "2025-06-02T20:00:00.000Z";
const close = "2025-06-02T22:00:00.000Z";
const kickoff = "2025-06-02T18:00:00.000Z";
export const provider = "api-football";
export const competition = {
  id: "wrapped-league",
  name: "Demo League",
  type: "league",
  countryName: "Costa Rica",
  externalProvider: provider,
  externalProviderId: "999999",
  createdAt: start,
  updatedAt: start,
} satisfies Competition;
export const season = {
  id: "wrapped-season",
  competitionId: competition.id,
  name: "Demo Season",
  externalProvider: provider,
  externalProviderSeason: 2025,
  isCurrent: false,
  createdAt: start,
  updatedAt: start,
} satisfies Season;

export function wrappedTeam(slug: ClubSlug): Team {
  return {
    id: clubs[slug].teamId,
    displayName: clubs[slug].displayName,
    shortName: clubs[slug].shortName,
    countryName: "Costa Rica",
    countryCode: "CR",
    brandingKey: slug,
    externalProviderId: slug === "herediano" ? "111" : "222",
    createdAt: start,
    updatedAt: start,
  };
}

export function wrappedMatch(
  slug: ClubSlug,
  fixture: string,
  changes: Partial<Match> = {},
): Match {
  const team = wrappedTeam(slug);
  return {
    id: trackedMatchId(provider, fixture, team.id),
    trackedTeamId: team.id,
    trackedTeamExternalProviderId: team.externalProviderId,
    homeTeam: { externalProviderId: "111", name: "Home" },
    awayTeam: { externalProviderId: "222", name: "Away" },
    competitionId: competition.id,
    seasonId: season.id,
    kickoffAt: kickoff,
    status: "finished",
    score: { home: 1, away: 0 },
    ratingState: "rating_closed",
    votingOpensAt: start,
    votingClosesAt: close,
    externalProvider: provider,
    externalProviderFixtureId: fixture,
    createdAt: start,
    updatedAt: close,
    ...changes,
  };
}

export function wrappedSummary(match: Match, ballotCount = 12): MatchResult {
  return {
    matchId: match.id,
    teamId: match.trackedTeamId,
    status: ballotCount ? "final" : "no_votes",
    ballotCount,
    generatedAt: close,
    playerResults: {
      player: {
        playerId: "player",
        playerName: "Player",
        average: ballotCount ? 8 : 0,
        voteCount: ballotCount,
        order: 0,
      },
    },
    coachResult: {
      coachId: "coach",
      coachName: "Coach",
      average: ballotCount ? 7 : 0,
      voteCount: ballotCount,
    },
    mvpPlayerIds: ballotCount ? ["player"] : [],
  };
}

export function wrappedFixture(match: Match) {
  return {
    matchId: match.id,
    providerFixtureId: match.externalProviderFixtureId,
    stage: "regular",
    evidence: "Synthetic schedule evidence",
    disposition: "expected" as const,
  };
}

export function ledgerInput(
  slug: ClubSlug,
  fixtures: unknown[],
  overrides: Partial<WrappedTournament> = {},
) {
  return {
    version: 1,
    clubSlug: slug,
    teamId: clubs[slug].teamId,
    tournaments: [
      {
        competitionId: competition.id,
        provider,
        providerCompetitionId: competition.externalProviderId,
        seasonId: season.id,
        providerSeason: season.externalProviderSeason,
        seasonStartYear: 2025,
        seasonEndYear: 2025,
        edition: "clausura",
        editionYear: 2025,
        stages: ["regular", "finals"],
        review: {
          source: "Synthetic approved calendar",
          reviewedBy: "operator",
          reviewedAt: "2025-06-30T00:00:00.000Z",
        },
        completion: {
          source: "Synthetic completion evidence",
          completedAt: "2025-06-29T00:00:00.000Z",
        },
        ...overrides,
        fixtures,
      },
    ],
  };
}
