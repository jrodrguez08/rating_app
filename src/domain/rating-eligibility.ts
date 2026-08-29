import type { MatchParticipant } from "./models";

/** Future ballots may include only confirmed participants for the tracked Team. */
export function isParticipantRateable(
  participant: Pick<MatchParticipant, "teamId" | "participated">,
  trackedTeamId: string,
): boolean {
  return participant.teamId === trackedTeamId && participant.participated;
}

export function getRateableParticipants<
  T extends Pick<MatchParticipant, "teamId" | "participated">,
>(participants: T[], trackedTeamId: string): T[] {
  return participants.filter((participant) =>
    isParticipantRateable(participant, trackedTeamId),
  );
}
