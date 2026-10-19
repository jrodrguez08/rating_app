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
export interface StandingsRow {
  rank: number;
  externalTeamId: string;
  teamName: string;
  logoUrl?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}
export interface StandingsSnapshot {
  id: EntityId;
  trackedTeamId: EntityId;
  competitionId: EntityId;
  competitionName: string;
  seasonId: EntityId;
  seasonName: string;
  externalProvider: string;
  externalProviderCompetitionId: string;
  externalProviderSeason: number;
  rows: StandingsRow[];
  providerSyncedAt: string;
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
export type RatingBlockReason =
  | "ambiguous_coach"
  | "missing_coach_evidence"
  | "missing_participant_evidence"
  | "provider_failure"
  | "unknown";
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
  lineupSnapshotAt?: string;
  lineupCaptureAttempts?: number;
  liveLineupCaptureAttempts?: number;
  lineupCaptureLastAttemptAt?: string;
  lineupCaptureLastOutcome?: LineupCaptureOutcome;
  participantSyncedAt?: string;
  finishedObservedAt?: string;
  lastLifecycleRequestedAt?: string;
  ratingBlockReason?: RatingBlockReason;
  ratingBlockObservedAt?: string;
  ratingReadyAt?: string;
  votingOpensAt?: string;
  votingClosesAt?: string;
  votingOpeningMode?: "provider" | "manual";
  manualFinalWhistleAttestedAt?: string;
  votingReopenedAt?: string;
  votingReopenCount?: number;
  effectiveVotingOpensAt?: string;
  effectiveVotingClosesAt?: string;
  votingClosedEarlyAt?: string;
  votingOpenNotificationWindow?: number;
  votingOpenNotificationStatus?: "pending" | "sending" | "sent";
  votingOpenNotificationAttemptId?: string;
  votingOpenNotificationFirstAttemptAt?: string;
  votingOpenNotificationAttemptedAt?: string;
  votingOpenNotificationLeaseUntil?: string;
  votingOpenNotificationSentAt?: string;
  votingOpenNotificationProviderId?: string;
  externalProvider: string;
  externalProviderFixtureId: string;
  createdAt: string;
  updatedAt: string;
}
export interface ManualFinalWhistleAttestation {
  matchId: EntityId;
  trackedTeamId: EntityId;
  externalFixtureId: string;
  operatorId: string;
  actualMatchEnded: true;
  verificationSource: string;
  verificationReason: string;
  providerStatusObserved: MatchStatus;
  provenance: "operator_verified";
  attestedAt: string;
  createdAt: string;
}
export type LineupCaptureOutcome =
  | "attempting"
  | "complete"
  | "unavailable"
  | "incomplete"
  | "provider_failure"
  | "rejected";
export interface FootballSyncMetadata {
  teamId: EntityId;
  lastFixtureDiscoveryAt?: string;
  lifecycleAttemptId?: string;
  lifecycleMatchId?: string;
  lifecycleLeaseUntil?: string;
  lastLifecycleTrigger?: "scheduled" | "operator";
  lastLifecycleStartedAt?: string;
  lastLifecycleCompletedAt?: string;
  lastLifecycleAttemptId?: string;
  lastLifecycleAction?: string;
  lastLifecycleMatchId?: string;
  lastLifecycleProviderRequests?: number;
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
  identityProvenance?: "provider" | "operator_verified";
  currentTeamId?: EntityId;
  externalProvider?: string;
  externalProviderId?: string;
  position?: PlayerPosition;
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}
export interface PlayerProviderAlias {
  id: EntityId;
  canonicalPlayerId: EntityId;
  canonicalExternalProviderPlayerId: string;
  externalProvider: string;
  externalProviderPlayerId: string;
  createdAt: string;
  updatedAt: string;
}
export interface PlayerIdentityReview {
  id: EntityId;
  firstPlayerId: EntityId;
  secondPlayerId: EntityId;
  trackedTeamId: EntityId;
  canonicalPlayerId: EntityId;
  providerPlayerId?: EntityId;
  externalProvider?: string;
  externalProviderPlayerId?: string;
  decision: "nonmatch";
  status: "active" | "corrected";
  verificationSource: string;
  verificationReason: string;
  operatorId: string;
  reviewedAt: string;
  correctedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface TeamPlayerMembership {
  playerId: EntityId;
  teamId: EntityId;
  displayName: string;
  searchName: string;
  searchPrefixes: string[];
  source: "current_squad" | "match_participant" | "operator_verified";
  sourceMatchId?: EntityId;
  shirtNumber?: number;
  firstObservedAt: string;
  lastObservedAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface TeamPlayerMembershipIndex {
  teamId: EntityId;
  status: "complete" | "incomplete";
  schemaVersion: 1;
  baselineMembershipCount: number;
  blockingIssueCount: number;
  auditedAt: string;
}
export type SquadRole = "starter" | "substitute";
export type ParticipationStatus =
  | "confirmed_starter"
  | "confirmed_substitute"
  | "unused_substitute"
  | "unconfirmed";
export interface MatchParticipant {
  matchId: EntityId;
  playerId: EntityId;
  teamId: EntityId;
  externalProvider?: string;
  externalProviderTeamId: string;
  externalProviderPlayerId?: string;
  playerName: string;
  shirtNumber?: number;
  position?: string;
  squadRole: SquadRole;
  starter: boolean;
  participated: boolean;
  participationStatus?: ParticipationStatus;
  identityProvenance?: "provider" | "operator_verified";
  participationProvenance?: "provider" | "operator_verified";
  verificationSource?: string;
  verificationReason?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  enteredAtMinute?: number;
  exitedAtMinute?: number;
  captain?: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface VerifiedLineupParticipant {
  playerId: EntityId;
  playerName: string;
  squadRole: SquadRole;
  participationStatus: ParticipationStatus;
  participated: boolean;
  identityProvenance: "provider" | "operator_verified";
  externalProviderPlayerId?: string;
  shirtNumber?: number;
  position?: PlayerPosition;
  enteredAtMinute?: number;
  verificationSource: string;
  verificationReason: string;
  verifiedBy: string;
  verifiedAt: string;
}
export interface VerifiedLineupSnapshot {
  matchId: EntityId;
  trackedTeamId: EntityId;
  externalProvider: string;
  externalFixtureId: string;
  participants: VerifiedLineupParticipant[];
  operatorId: string;
  verificationSource: string;
  verificationReason: string;
  provenance: "operator_verified";
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface AdminLineupDraftParticipant {
  playerId: EntityId;
  playerName: string;
  createInternalIdentity: boolean;
  identityAllocationToken?: string;
  squadRole: SquadRole;
  participationStatus: ParticipationStatus;
  shirtNumber?: number;
  position?: PlayerPosition;
  enteredAtMinute?: number;
}
export interface AdminLineupDraft {
  matchId: EntityId;
  trackedTeamId: EntityId;
  externalFixtureId: string;
  ownerId: string;
  version: number;
  contentHash: string;
  participants: AdminLineupDraftParticipant[];
  createdAt: string;
  updatedAt: string;
}
export interface VerifiedLineupReconciliation {
  matchId: EntityId;
  trackedTeamId: EntityId;
  externalProvider: string;
  externalFixtureId: string;
  status: "matched" | "provider_missing" | "provider_partial" | "conflict";
  reason: string;
  observedAt: string;
  providerParticipantCount?: number;
}
export interface CoachAssignment {
  matchId: EntityId;
  coachId: EntityId;
  teamId: EntityId;
  externalProviderTeamId: string;
  role: "head-coach";
  coachName: string;
  provenance?: "provider" | "operator_verified";
  createdAt: string;
  updatedAt: string;
}
export interface Coach {
  id: EntityId;
  displayName: string;
  identityProvenance?: "provider" | "operator_verified";
  externalProvider?: string;
  externalProviderId?: string;
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}
export interface VerifiedCoachAssignment {
  matchId: EntityId;
  trackedTeamId: EntityId;
  externalProvider: string;
  externalFixtureId: string;
  coachId: EntityId;
  verificationSource: string;
  verificationReason: string;
  operatorId: string;
  provenance: "operator_verified";
  verifiedAt: string;
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
