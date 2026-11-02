import type { MatchArchiveItem } from "@/application/match-archive";
import {
  getEffectiveVotingWindow,
  getVotingWindowState,
} from "@/domain/voting-window";
import type { Messages } from "@/i18n/messages";

export function matchPresentation(
  item: MatchArchiveItem,
  messages: Messages["matches"],
  now: Date,
) {
  const { match, hasResults } = item;
  const votingWindowState = getVotingWindowState(match, now);
  const votingWindow = getEffectiveVotingWindow(match);
  if (votingWindowState === "active" && votingWindow !== null)
    return {
      label: messages.votingOpen,
      description: messages.votingDescription,
      ballotAware: true,
      votingClosesAt: votingWindow.closesAt,
    };
  if (hasResults && match.ratingState === "rating_closed")
    return {
      label: messages.resultsAvailable,
      description: messages.resultsDescription,
      action: messages.results,
      href: `/matches/${match.id}/results`,
      primary: true,
    };
  if (match.ratingState === "rating_closed")
    return {
      label: messages.final,
      description: messages.noRating,
    };
  if (match.ratingState === "rating_ready") {
    if (votingWindowState === "closed") {
      return {
        label: messages.votingClosed,
        description: messages.votingClosedDescription,
      };
    }
    if (votingWindow !== null && now < new Date(votingWindow.opensAt)) {
      return {
        label: messages.votingScheduled,
        description: messages.votingScheduledDescription,
      };
    }
    return {
      label: messages.votingUnavailable,
      description: messages.votingUnavailableDescription,
    };
  }
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
