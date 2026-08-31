"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type {
  MatchArchive,
  MatchArchiveItem,
} from "@/application/match-archive";
import { getTeamBadgePresentation } from "@/config/team-badges";
import type { Match, MatchGoalEvent } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

import { BallotEntry } from "./ballot-entry";
import { TeamBadge } from "./team-badge";

type MatchMessages = Messages["matches"];
type BallotMessages = Messages["home"]["matchLifecycle"]["ready"];

export function MatchArchiveView({
  archive,
  locale,
  messages,
  ballotMessages,
  now = new Date(),
}: {
  archive: MatchArchive;
  locale: Locale;
  messages: MatchMessages;
  ballotMessages: BallotMessages;
  now?: Date;
}) {
  const [selectedTab, setSelectedTab] = useState<"upcoming" | "recent">(
    "upcoming",
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = [
    {
      id: "upcoming",
      label: messages.upcoming,
      empty: messages.noUpcoming,
      items: archive.upcoming,
    },
    {
      id: "recent",
      label: messages.recent,
      empty: messages.noRecent,
      items: archive.recent,
    },
  ] as const;
  const selectedIndex = tabs.findIndex(({ id }) => id === selectedTab);
  const selected = tabs[selectedIndex];

  function selectTab(index: number) {
    const nextIndex = (index + tabs.length) % tabs.length;
    setSelectedTab(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

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
            ballotMessages={ballotMessages}
            now={now}
            featured
          />
        </section>
      ) : null}
      <section
        className="mt-8"
        aria-label={`${messages.upcoming} / ${messages.recent}`}
      >
        <div
          role="tablist"
          aria-label={`${messages.upcoming} / ${messages.recent}`}
          className="grid grid-cols-2 border-2 border-border bg-surface shadow-[2px_2px_0_var(--game-shadow)]"
        >
          {tabs.map((tab, index) => {
            const isSelected = tab.id === selectedTab;
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                id={`${tab.id}-tab`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={`${tab.id}-panel`}
                tabIndex={isSelected ? 0 : -1}
                className={`score-font min-h-11 border-b-4 px-3 py-2 focus-visible:z-10 ${
                  isSelected
                    ? "border-accent bg-panel font-bold text-accent"
                    : "border-transparent text-muted"
                }`}
                onClick={() => setSelectedTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    selectTab(index + 1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    selectTab(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    selectTab(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    selectTab(tabs.length - 1);
                  }
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div
          id={`${selected.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${selected.id}-tab`}
          tabIndex={0}
          className="mt-4 focus-visible:outline-none"
        >
          <ArchiveItems
            empty={selected.empty}
            items={selected.items}
            locale={locale}
            messages={messages}
            ballotMessages={ballotMessages}
            now={now}
          />
        </div>
      </section>
    </>
  );
}

function ArchiveItems({
  empty,
  items,
  ...props
}: {
  empty: string;
  items: MatchArchiveItem[];
  locale: Locale;
  messages: MatchMessages;
  ballotMessages: BallotMessages;
  now: Date;
}) {
  return (
    <>
      {items.length === 0 ? (
        <p className="game-inset p-4 text-muted">{empty}</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <CompactMatchCard key={item.match.id} item={item} {...props} />
          ))}
        </div>
      )}
    </>
  );
}

export function MatchCard({
  item,
  locale,
  messages,
  ballotMessages,
  now,
  featured = false,
}: {
  item: MatchArchiveItem;
  locale: Locale;
  messages: MatchMessages;
  ballotMessages: BallotMessages;
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
        <MatchAction
          item={item}
          presentation={presentation}
          messages={messages}
          ballotMessages={ballotMessages}
        />
      </div>
    </article>
  );
}

function CompactMatchCard({
  item,
  locale,
  messages,
  ballotMessages,
  now,
}: {
  item: MatchArchiveItem;
  locale: Locale;
  messages: MatchMessages;
  ballotMessages: BallotMessages;
  now: Date;
}) {
  const { match } = item;
  const presentation = matchPresentation(item, messages, now);
  const showScore =
    match.status === "finished" &&
    match.score.home !== null &&
    match.score.away !== null;
  return (
    <article className="game-inset px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <time
          dateTime={match.kickoffAt}
          className="text-xs font-semibold text-muted"
        >
          {formatDate(match.kickoffAt, locale, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
        <span className="status-badge">{presentation.label}</span>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <p className="min-w-0 break-words text-sm font-bold">
          {match.homeTeam.name}
        </p>
        <span className="score-font text-lg text-accent">
          {showScore ? `${match.score.home} - ${match.score.away}` : "VS"}
        </span>
        <p className="min-w-0 break-words text-right text-sm font-bold">
          {match.awayTeam.name}
        </p>
      </div>
      {item.competitionName ? (
        <p className="mt-2 text-xs text-muted">{item.competitionName}</p>
      ) : null}
      <MatchAction
        item={item}
        presentation={presentation}
        messages={messages}
        ballotMessages={ballotMessages}
        compact
      />
    </article>
  );
}

function MatchAction({
  item,
  presentation,
  messages,
  ballotMessages,
  compact = false,
}: {
  item: MatchArchiveItem;
  presentation: ReturnType<typeof matchPresentation>;
  messages: MatchMessages;
  ballotMessages: BallotMessages;
  compact?: boolean;
}) {
  if ("ballotAware" in presentation && presentation.ballotAware) {
    return (
      <BallotEntry
        matchId={item.match.id}
        messages={ballotMessages}
        compact={compact}
      />
    );
  }
  return (
    <Link
      href={presentation.href ?? `/matches/${item.match.id}`}
      className={
        compact
          ? "mt-2 inline-flex min-h-11 items-center font-bold text-accent underline decoration-2 underline-offset-4"
          : `${presentation.primary ? "button-primary" : "button-secondary"} mt-4 inline-flex min-h-11 w-full items-center justify-center px-4 py-3 font-bold`
      }
    >
      {presentation.action ?? messages.details}
      {compact ? <span aria-hidden="true">&nbsp;→</span> : null}
    </Link>
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
