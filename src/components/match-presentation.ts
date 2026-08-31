import type { MatchArchiveItem } from "@/application/match-archive";
import type { Messages } from "@/i18n/messages";

export function matchPresentation(
  item: MatchArchiveItem,
  messages: Messages["matches"],
  now: Date,
) {
  const { match, hasResults } = item;
  const votingOpen =
    match.ratingState === "rating_ready" &&
    match.votingOpensAt !== undefined &&
    match.votingClosesAt !== undefined &&
    now >= new Date(match.votingOpensAt) &&
    now < new Date(match.votingClosesAt);
  if (votingOpen)
    return {
      label: messages.votingOpen,
      description: messages.votingDescription,
      ballotAware: true,
    };
  if (hasResults && match.ratingState === "rating_closed")
    return {
      label: messages.resultsAvailable,
      description: messages.resultsDescription,
      action: messages.results,
      href: `/matches/${match.id}/results`,
      primary: true,
    };
  if (match.status === "live")
    return {
      label: `${messages.live}${match.elapsedMinute === undefined ? "" : ` · ${match.elapsedMinute}'`}`,
      description: messages.liveDescription,
    };
  if (match.status === "scheduled")
    return {
      label: messages.scheduled,
      description: messages.scheduledDescription,
    };
  if (match.ratingState === "preparing_rating")
    return {
      label: messages.preparing,
      description: messages.preparingDescription,
    };
  return { label: messages.final, description: messages.noRating };
}
