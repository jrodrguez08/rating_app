export type EntityId = string;
export interface Team {
  id: EntityId;
  displayName: string;
  shortName: string;
  countryCode: string;
  externalProviderId?: string;
  brandingKey: string;
  createdAt: string;
  updatedAt: string;
}
export interface Competition {
  id: EntityId;
  name: string;
  countryCode?: string;
  externalProviderId?: string;
}
export interface Season {
  id: EntityId;
  competitionId: EntityId;
  name: string;
  startsAt: string;
  endsAt: string;
}
export type MatchStatus =
  "scheduled" | "live" | "finished" | "postponed" | "cancelled";
export interface Match {
  id: EntityId;
  teamId: EntityId;
  opponentTeamId: EntityId;
  competitionId: EntityId;
  seasonId: EntityId;
  homeTeamId: EntityId;
  awayTeamId: EntityId;
  kickoffAt: string;
  status: MatchStatus;
  score?: { home: number; away: number };
  votingOpensAt?: string;
  votingClosesAt?: string;
  externalProviderFixtureId?: string;
}
export interface Player {
  id: EntityId;
  name: string;
  externalProviderPlayerId?: string;
}
export type SquadRole = "starter" | "substitute";
export interface MatchParticipant {
  matchId: EntityId;
  playerId: EntityId;
  squadRole: SquadRole;
  participated: boolean;
  enteredAtMinute?: number;
  leftAtMinute?: number;
}
export interface CoachAssignment {
  matchId: EntityId;
  coachId: EntityId;
  teamId: EntityId;
}
export interface Coach {
  id: EntityId;
  name: string;
  externalProviderCoachId?: string;
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
