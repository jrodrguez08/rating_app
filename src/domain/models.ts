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
export interface Match {
  id: EntityId;
  trackedTeamId: EntityId;
  competitionId: EntityId;
  seasonId: EntityId;
  homeTeam: MatchTeamSnapshot;
  awayTeam: MatchTeamSnapshot;
  kickoffAt: string;
  status: MatchStatus;
  ratingState: RatingState;
  score: { home: number | null; away: number | null };
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
export interface Player {
  id: EntityId;
  displayName: string;
  externalProvider: string;
  externalProviderId: string;
  position?: string;
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
  submittedAt: string;
  playerRatings: Record<EntityId, number>;
  coachRating: { coachId: EntityId; rating: number };
}
export interface MatchRatingAggregate {
  matchId: EntityId;
  ballotCount: number;
  playerAverages: Record<EntityId, number>;
  coachAverage: number;
  updatedAt: string;
}
export interface TeamPresentation {
  teamId: EntityId;
  displayName: string;
  shortName: string;
  theme: { primary: string; accent: string };
}
