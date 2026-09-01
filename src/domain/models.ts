export type EntityId = string;
export interface Team {
  id: EntityId;
  displayName: string;
  shortName: string;
  countryName: string;
  countryCode: string;
  externalProviderId?: string;
  brandingKey: string;
  createdAt: string;
  updatedAt: string;
}
export interface Competition {
  id: EntityId;
  name: string;
  countryName: string;
  countryCode?: string;
  type: "league" | "cup";
  externalProvider: string;
  externalProviderId: string;
  createdAt: string;
  updatedAt: string;
}
export interface Season {
  id: EntityId;
  competitionId: EntityId;
  name: string;
  externalProvider: string;
  externalProviderSeason: number;
  startsAt?: string;
  endsAt?: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
}
export type MatchStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "postponed"
  | "suspended"
  | "cancelled"
  | "abandoned";
export type RatingState =
  "not_ready" | "preparing_rating" | "rating_ready" | "rating_closed";
export interface MatchTeamSnapshot {
  externalProviderId: string;
  name: string;
  logoUrl?: string;
}
export interface MatchGoalEvent {
  externalTeamId: string;
  externalPlayerId: string;
  scorerName: string;
  elapsed: number;
  extra?: number;
  kind: "normal" | "penalty" | "own_goal" | "other";
}
export interface Match {
  id: EntityId;
  trackedTeamId: EntityId;
  trackedTeamExternalProviderId?: string;
  competitionId: EntityId;
  seasonId: EntityId;
  homeTeam: MatchTeamSnapshot;
  awayTeam: MatchTeamSnapshot;
  kickoffAt: string;
  status: MatchStatus;
  ratingState: RatingState;
  score: { home: number | null; away: number | null };
  elapsedMinute?: number;
  goalEvents?: MatchGoalEvent[];
  lastProviderSyncAt?: string;
  participantSyncedAt?: string;
  ratingReadyAt?: string;
  votingOpensAt?: string;
  votingClosesAt?: string;
  externalProvider: string;
  externalProviderFixtureId: string;
  createdAt: string;
  updatedAt: string;
}
export interface FootballSyncMetadata {
  teamId: EntityId;
  lastFixtureDiscoveryAt?: string;
  updatedAt: string;
}

export interface VoterIdentity {
  voterId: string;
}
export type PlayerPosition =
  "goalkeeper" | "defender" | "midfielder" | "attacker";
export interface Player {
  id: EntityId;
  displayName: string;
  externalProvider: string;
  externalProviderId: string;
  position?: PlayerPosition;
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}
export type SquadRole = "starter" | "substitute";
export interface MatchParticipant {
  matchId: EntityId;
  playerId: EntityId;
  teamId: EntityId;
  externalProvider: string;
  externalProviderTeamId: string;
  externalProviderPlayerId: string;
  playerName: string;
  shirtNumber?: number;
  position?: string;
  squadRole: SquadRole;
  starter: boolean;
  participated: boolean;
  enteredAtMinute?: number;
  exitedAtMinute?: number;
  captain?: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CoachAssignment {
  matchId: EntityId;
  coachId: EntityId;
  teamId: EntityId;
  externalProviderTeamId: string;
  role: "head-coach";
  coachName: string;
  createdAt: string;
  updatedAt: string;
}
export interface Coach {
  id: EntityId;
  displayName: string;
  externalProvider: string;
  externalProviderId: string;
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}
export interface Ballot {
  id: EntityId;
  matchId: EntityId;
  voterId: EntityId;
  teamId: EntityId;
  submittedAt: string;
  playerRatings: Record<EntityId, number>;
  coachRating: { coachId: EntityId; rating: number };
}

export interface BallotPlayer {
  id: EntityId;
  name: string;
  position?: string;
  substitute: boolean;
}

export interface BallotContext {
  matchId: EntityId;
  teamId: EntityId;
  homeTeamName: string;
  awayTeamName: string;
  score: { home: number | null; away: number | null };
  votingClosesAt: string;
  players: BallotPlayer[];
  coach: { id: EntityId; name: string };
}

export interface BallotRatings {
  playerRatings: Record<EntityId, number>;
  coachRating: { coachId: EntityId; rating: number };
}
export interface PlayerResult {
  playerId: EntityId;
  playerName: string;
  position?: string;
  average: number;
  voteCount: number;
  order: number;
}
export interface MatchResult {
  matchId: EntityId;
  teamId: EntityId;
  ballotCount: number;
  playerResults: Record<EntityId, PlayerResult>;
  coachResult: {
    coachId: EntityId;
    coachName: string;
    average: number;
    voteCount: number;
  };
  mvpPlayerIds: EntityId[];
  status: "final" | "no_votes";
  generatedAt: string;
}
export interface TeamPresentation {
  teamId: EntityId;
  displayName: string;
  shortName: string;
  theme: { primary: string; accent: string };
}
