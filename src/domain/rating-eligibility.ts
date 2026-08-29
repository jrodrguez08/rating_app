import type { MatchParticipant } from "./models";

/** Future ballots may include only provider-confirmed match participants. */
export function isParticipantRateable(
  participant: Pick<MatchParticipant, "participated">,
): boolean {
  return participant.participated;
}

export function getRateableParticipants<
  T extends Pick<MatchParticipant, "participated">,
>(participants: T[]): T[] {
  return participants.filter(isParticipantRateable);
}
