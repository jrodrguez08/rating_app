import { validateBallotRatings } from "@/domain/ballot-validation";
import type {
  Ballot,
  CoachAssignment,
  MatchParticipant,
  MatchResult,
} from "@/domain/models";

export class ResultIntegrityError extends Error {}

export function aggregateMatchResult({
  matchId,
  teamId,
  participants,
  coach,
  ballots,
  generatedAt,
}: {
  matchId: string;
  teamId: string;
  participants: MatchParticipant[];
  coach: CoachAssignment;
  ballots: Ballot[];
  generatedAt: string;
}): MatchResult {
  const eligible = participants.filter(
    (participant) => participant.teamId === teamId && participant.participated,
  );
  if (eligible.length === 0 || coach.teamId !== teamId) {
    throw new ResultIntegrityError("Rating eligibility is incomplete.");
  }
  const playerIds = eligible.map((participant) => participant.playerId);
  if (new Set(playerIds).size !== playerIds.length) {
    throw new ResultIntegrityError("Rating eligibility contains duplicates.");
  }
  const sums = Object.fromEntries(playerIds.map((id) => [id, 0]));
  let coachSum = 0;
  for (const ballot of ballots) {
    if (
      ballot.id !== ballot.voterId ||
      ballot.matchId !== matchId ||
      ballot.teamId !== teamId
    ) {
      throw new ResultIntegrityError(
        "A persisted ballot has invalid ownership.",
      );
    }
    const validation = validateBallotRatings(playerIds, coach.coachId, {
      playerRatings: ballot.playerRatings,
      coachRating: ballot.coachRating,
    });
    if (!validation.valid) {
      throw new ResultIntegrityError("A persisted ballot is malformed.");
    }
    for (const id of playerIds)
      sums[id] += validation.ratings.playerRatings[id];
    coachSum += validation.ratings.coachRating.rating;
  }
  const ballotCount = ballots.length;
  const playerResults = Object.fromEntries(
    eligible.map((participant, order) => [
      participant.playerId,
      {
        playerId: participant.playerId,
        playerName: participant.playerName,
        ...(participant.position ? { position: participant.position } : {}),
        average:
          ballotCount === 0 ? 0 : sums[participant.playerId] / ballotCount,
        voteCount: ballotCount,
        order,
      },
    ]),
  );
  const highest =
    ballotCount === 0
      ? 0
      : Math.max(
          ...Object.values(playerResults).map((result) => result.average),
        );
  return {
    matchId,
    teamId,
    ballotCount,
    playerResults,
    coachResult: {
      coachId: coach.coachId,
      coachName: coach.coachName,
      average: ballotCount === 0 ? 0 : coachSum / ballotCount,
      voteCount: ballotCount,
    },
    mvpPlayerIds:
      ballotCount === 0
        ? []
        : Object.values(playerResults)
            .filter((result) => result.average === highest)
            .sort((left, right) => left.order - right.order)
            .map((result) => result.playerId),
    status: ballotCount === 0 ? "no_votes" : "final",
    generatedAt,
  };
}
