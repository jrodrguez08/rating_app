import type {
  Ballot,
  Competition,
  Coach,
  CoachAssignment,
  EntityId,
  FootballSyncMetadata,
  Match,
  MatchParticipant,
  Player,
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
  elapsedMinute?: number;
  goalEvents?: Match["goalEvents"];
}

export interface ProviderMatchParticipant {
  externalTeamId: string;
  externalPlayerId: string;
  name: string;
  shirtNumber?: number;
  position?: string;
  squadRole: "starter" | "substitute";
  participated: boolean;
  enteredAtMinute?: number;
  exitedAtMinute?: number;
  captain?: boolean;
}

export interface ProviderHeadCoach {
  externalTeamId: string;
  externalCoachId: string;
  name: string;
  photoUrl?: string;
}

export interface ProviderMatchContext {
  participants: ProviderMatchParticipant[];
  headCoach: ProviderHeadCoach;
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
    competitionSeasons: ProviderCompetitionSeason[],
  ): Promise<ProviderFixture[]>;
  getFixture(externalFixtureId: string): Promise<ProviderFixture>;
  getMatchContext(
    externalFixtureId: string,
    externalTeamId: string,
  ): Promise<ProviderMatchContext>;
}

export interface MatchLifecycleStore extends FootballSyncStore {
  listMatches(trackedTeamId: string): Promise<Match[]>;
  updateMatchLifecycle(match: Match): Promise<void>;
  countRateableParticipants(matchId: string, teamId: string): Promise<number>;
  hasTrackedTeamHeadCoach(matchId: string, teamId: string): Promise<boolean>;
  finalizeMatchResult(matchId: string, now: Date): Promise<void>;
  getSyncMetadata(teamId: string): Promise<FootballSyncMetadata | null>;
  setSyncMetadata(metadata: FootballSyncMetadata): Promise<void>;
}

export interface FootballSyncStore {
  getTeam(teamId: string): Promise<Team>;
  getMatch(matchId: string): Promise<Match>;
  updateTeamProviderId(team: Team, externalProviderId: string): Promise<Team>;
  upsertCompetitions(competitions: Competition[]): Promise<SyncWriteCounts>;
  upsertSeasons(seasons: Season[]): Promise<SyncWriteCounts>;
  upsertMatches(matches: Match[]): Promise<SyncWriteCounts>;
  upsertPlayers(players: Player[]): Promise<SyncWriteCounts>;
  upsertMatchParticipants(
    matchId: string,
    participants: MatchParticipant[],
  ): Promise<SyncWriteCounts>;
  upsertCoaches(coaches: Coach[]): Promise<SyncWriteCounts>;
  upsertCoachAssignment(
    matchId: string,
    assignment: CoachAssignment,
  ): Promise<SyncWriteCounts>;
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
