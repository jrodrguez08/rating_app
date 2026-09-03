import Link from "next/link";

import { getTeamBadgePresentation } from "@/config/team-badges";
import { buildWhatsAppRatingShareUrl } from "@/config/whatsapp-share";
import type { Match } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

import { BallotEntry } from "./ballot-entry";
import { TeamBadge } from "./team-badge";

export function MatchLifecyclePanel({
  match,
  locale,
  messages,
}: {
  match: Match;
  locale: Locale;
  messages: Messages["home"]["matchLifecycle"];
}) {
  const state = presentationState(match, messages);
  const showScore =
    (match.status === "live" || match.status === "finished") &&
    match.score.home !== null &&
    match.score.away !== null;
  return (
    <section
      aria-labelledby="match-status-heading"
      className="card overflow-hidden"
    >
      <div aria-hidden="true" className="flex h-2">
        <span className="w-3/4 bg-brand" />
        <span className="w-1/4 bg-accent" />
      </div>
      <div className="px-4 py-5 sm:px-7 sm:py-7">
        {state.compactHeading ? (
          <h2 id="match-status-heading" className="status-badge">
            {state.label}
          </h2>
        ) : (
          <>
            <span className="status-badge">{state.label}</span>
            <h2
              id="match-status-heading"
              className="score-font mt-4 text-2xl leading-tight text-foreground sm:text-3xl"
            >
              {state.title}
            </h2>
          </>
        )}
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-center sm:mt-5 sm:gap-4">
          <TeamName team={match.homeTeam} />
          <span className="score-font text-2xl text-accent sm:text-3xl">
            {showScore
              ? `${match.score.home} - ${match.score.away}`
              : messages.versus}
          </span>
          <TeamName team={match.awayTeam} />
        </div>
        <p className="mt-4 text-center text-sm leading-6 text-muted">
          {formatDate(match.kickoffAt, locale, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        <p className="game-inset mt-5 border-l-2 border-l-accent p-3 text-sm font-medium leading-6 text-foreground">
          {state.description}
        </p>
        {isVotingOpen(match) ? (
          <BallotEntry
            matchId={match.id}
            messages={messages.ready}
            shareHref={buildWhatsAppRatingShareUrl(match.id)}
          />
        ) : null}
        {match.ratingState === "rating_closed" ? (
          <Link
            href={`/matches/${match.id}/results`}
            className="button-primary mt-5 inline-flex min-h-11 w-full items-center justify-center px-4 py-3 font-bold"
          >
            {messages.results.action}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function isVotingOpen(match: Match): boolean {
  const now = Date.now();
  return (
    match.ratingState === "rating_ready" &&
    match.votingOpensAt !== undefined &&
    match.votingClosesAt !== undefined &&
    now >= new Date(match.votingOpensAt).getTime() &&
    now < new Date(match.votingClosesAt).getTime()
  );
}

function TeamName({ team }: { team: Match["homeTeam"] }) {
  return (
    <div className="min-w-0">
      <TeamBadge presentation={getTeamBadgePresentation(team)} />
      <p className="mt-2 break-words text-sm font-semibold leading-5 text-foreground">
        {team.name}
      </p>
    </div>
  );
}

function presentationState(
  match: Match,
  messages: Messages["home"]["matchLifecycle"],
) {
  if (match.ratingState === "rating_ready") {
    return {
      label: messages.ready.label,
      title: messages.ready.title,
      description: messages.ready.description,
      compactHeading: false,
    };
  }
  if (match.ratingState === "rating_closed") {
    return {
      label: messages.results.label,
      title: messages.results.title,
      description: messages.results.description,
      compactHeading: false,
    };
  }
  if (match.status === "live") {
    return {
      label: messages.live.label,
      title: messages.live.title,
      description: messages.live.description,
      compactHeading: false,
    };
  }
  if (match.status === "finished" || match.ratingState === "preparing_rating") {
    return {
      label: messages.preparing.label,
      title: messages.preparing.title,
      description: messages.preparing.description,
      compactHeading: false,
    };
  }
  return {
    label: messages.upcoming.label,
    title: messages.upcoming.title,
    description: messages.upcoming.description,
    compactHeading: true,
  };
}
