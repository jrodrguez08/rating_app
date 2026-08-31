import Link from "next/link";

import type {
  MatchArchive,
  MatchArchiveItem,
} from "@/application/match-archive";
import { getTeamBadgePresentation } from "@/config/team-badges";
import type { Match, MatchGoalEvent } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

import { TeamBadge } from "./team-badge";

type MatchMessages = Messages["matches"];

export function MatchArchiveView({
  archive,
  locale,
  messages,
  now = new Date(),
}: {
  archive: MatchArchive;
  locale: Locale;
  messages: MatchMessages;
  now?: Date;
}) {
  return (
    <>
      <section aria-labelledby="matches-heading" className="mb-7">
        <p className="eyebrow">{messages.eyebrow}</p>
        <h1 id="matches-heading" className="mt-3 text-3xl font-extrabold">
          {messages.title}
        </h1>
        <p className="mt-3 leading-7 text-muted">{messages.introduction}</p>
      </section>
      {archive.relevant ? (
        <section aria-labelledby="featured-heading">
          <h2 id="featured-heading" className="score-font mb-3 text-xl">
            {messages.featured}
          </h2>
          <MatchCard
            item={archive.relevant}
            locale={locale}
            messages={messages}
            now={now}
            featured
          />
        </section>
      ) : null}
      <ArchiveSection
        id="recent-matches"
        title={messages.recent}
        empty={messages.noRecent}
        items={archive.recent}
        locale={locale}
        messages={messages}
        now={now}
      />
      <ArchiveSection
        id="upcoming-matches"
        title={messages.upcoming}
        empty={messages.noUpcoming}
        items={archive.upcoming}
        locale={locale}
        messages={messages}
        now={now}
      />
    </>
  );
}

function ArchiveSection({
  id,
  title,
  empty,
  items,
  ...props
}: {
  id: string;
  title: string;
  empty: string;
  items: MatchArchiveItem[];
  locale: Locale;
  messages: MatchMessages;
  now: Date;
}) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="score-font text-xl">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="game-inset mt-3 p-4 text-muted">{empty}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {items.map((item) => (
            <MatchCard key={item.match.id} item={item} {...props} />
          ))}
        </div>
      )}
    </section>
  );
}

export function MatchCard({
  item,
  locale,
  messages,
  now,
  featured = false,
}: {
  item: MatchArchiveItem;
  locale: Locale;
  messages: MatchMessages;
  now: Date;
  featured?: boolean;
}) {
  const { match } = item;
  const presentation = matchPresentation(item, messages, now);
  return (
    <article
      className={`card overflow-hidden ${featured ? "border-accent" : ""}`}
    >
      {featured ? <div aria-hidden="true" className="h-2 bg-brand" /> : null}
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="status-badge">{presentation.label}</span>
          {item.competitionName ? (
            <span className="text-xs font-semibold text-muted">
              {item.competitionName}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-sm text-muted">
          {formatDate(match.kickoffAt, locale, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        <Scoreboard match={match} />
        <p className="mt-3 text-sm font-semibold text-muted">
          {presentation.description}
        </p>
        <Link
          href={presentation.href ?? `/matches/${match.id}`}
          className={`${presentation.primary ? "button-primary" : "button-secondary"} mt-4 inline-flex min-h-11 w-full items-center justify-center px-4 py-3 font-bold`}
        >
          {presentation.action ?? messages.details}
        </Link>
      </div>
    </article>
  );
}

export function Scoreboard({ match }: { match: Match }) {
  const showScore =
    match.score.home !== null &&
    match.score.away !== null &&
    (match.status === "live" || match.status === "finished");
  return (
    <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-center">
      <Team team={match.homeTeam} />
      <span className="score-font text-2xl text-accent sm:text-3xl">
        {showScore ? `${match.score.home} - ${match.score.away}` : "VS"}
      </span>
      <Team team={match.awayTeam} />
    </div>
  );
}

function Team({ team }: { team: Match["homeTeam"] }) {
  return (
    <div className="min-w-0">
      <TeamBadge presentation={getTeamBadgePresentation(team)} />
      <p className="mt-2 break-words text-sm font-bold">{team.name}</p>
    </div>
  );
}

export function GoalSummary({
  match,
  messages,
}: {
  match: Match;
  messages: MatchMessages;
}) {
  const events = match.goalEvents ?? [];
  if (events.length === 0) return null;
  const trackedExternalId = match.trackedTeamExternalProviderId;
  return (
    <section aria-labelledby="goal-summary-heading" className="card mt-6 p-5">
      <h2 id="goal-summary-heading" className="score-font text-xl">
        {messages.goals}
      </h2>
      <ol className="mt-3 space-y-2">
        {events.map((event, index) => {
          const tracked =
            trackedExternalId !== undefined &&
            event.externalTeamId === trackedExternalId;
          const association =
            trackedExternalId === undefined
              ? messages.goal
              : tracked
                ? messages.trackedTeamGoal
                : messages.opponentGoal;
          return (
            <li
              key={`${event.externalTeamId}-${event.externalPlayerId}-${event.elapsed}-${event.extra ?? 0}-${index}`}
              className="game-inset flex items-center gap-3 p-3"
            >
              <span aria-hidden="true">⚽</span>
              <span className="min-w-0 flex-1 break-words font-bold">
                {event.scorerName}
              </span>
              <span className="score-font text-accent">
                {formatGoalMinute(event)}
              </span>
              <span className="sr-only">{association}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function formatGoalMinute(event: MatchGoalEvent): string {
  return `${event.elapsed}${event.extra && event.extra > 0 ? `+${event.extra}` : ""}'`;
}

export function matchPresentation(
  item: MatchArchiveItem,
  messages: MatchMessages,
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
      action: messages.rate,
      href: `/matches/${match.id}/rate`,
      primary: true,
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
