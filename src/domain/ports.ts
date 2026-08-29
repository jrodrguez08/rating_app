import type { Ballot, EntityId, Match, MatchParticipant } from "./models";
export interface MatchDataProvider { getMatch(externalFixtureId: string): Promise<Match>; getParticipants(externalFixtureId: string): Promise<MatchParticipant[]>; }
export interface BallotStore { submitOnce(ballot: Ballot): Promise<void>; findByVoterAndMatch(voterId: EntityId, matchId: EntityId): Promise<Ballot | null>; }
