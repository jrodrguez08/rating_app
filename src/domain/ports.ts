import type {
  Ballot,
  Competition,
  EntityId,
  Match,
  Season,
  Team,
} from "./models";

export interface TeamLookup {
  displayName: string;
  shortName: string;
  countryName: string;
}

export interface ProviderTeamIdentity {
  externalProviderId: string;
  name: string;
  countryName: string;
}

export interface ProviderCompetitionSeason {
  externalCompetitionId: string;
  competitionName: string;
  countryName: string;
  countryCode?: string;
  type: Competition["type"];
  providerSeason: number;
  startsAt?: string;
  endsAt?: string;
  isCurrent: boolean;
}

export interface ProviderFixture {
  externalFixtureId: string;
  externalCompetitionId: string;
  providerSeason: number;
  kickoffAt: string;
  status: Match["status"];
  homeTeam: Match["homeTeam"];
  awayTeam: Match["awayTeam"];
  score: Match["score"];
}

export interface FixtureWindow {
  from: string;
  to: string;
}

export interface FootballDataProvider {
  readonly name: string;
  readonly requestCount: number;
  resolveTeam(lookup: TeamLookup): Promise<ProviderTeamIdentity>;
  getCompetitionSeasons(
    externalTeamId: string,
  ): Promise<ProviderCompetitionSeason[]>;
  getFixtures(
    externalTeamId: string,
    window: FixtureWindow,
  ): Promise<ProviderFixture[]>;
}

export interface FootballSyncStore {
  updateTeamProviderId(team: Team, externalProviderId: string): Promise<Team>;
  upsertCompetitions(competitions: Competition[]): Promise<SyncWriteCounts>;
  upsertSeasons(seasons: Season[]): Promise<SyncWriteCounts>;
  upsertMatches(matches: Match[]): Promise<SyncWriteCounts>;
}

export interface SyncWriteCounts {
  created: number;
  updated: number;
  unchanged: number;
}

export interface BallotStore {
  submitOnce(ballot: Ballot): Promise<void>;
  findByVoterAndMatch(
    voterId: EntityId,
    matchId: EntityId,
  ): Promise<Ballot | null>;
}
