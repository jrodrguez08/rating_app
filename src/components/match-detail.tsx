import Link from "next/link";

import type { MatchArchiveItem } from "@/application/match-archive";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

import { GoalSummary, matchPresentation, Scoreboard } from "./match-archive";

export function MatchDetail({
  item,
  locale,
  messages,
  now = new Date(),
}: {
  item: MatchArchiveItem;
  locale: Locale;
  messages: Messages["matches"];
  now?: Date;
}) {
  const presentation = matchPresentation(item, messages, now);
  return (
    <>
      <article className="card overflow-hidden">
        <div aria-hidden="true" className="flex h-2">
          <span className="w-3/4 bg-brand" />
          <span className="w-1/4 bg-accent" />
        </div>
        <div className="p-5 sm:p-7">
          <span className="status-badge">{presentation.label}</span>
          <h1 className="score-font mt-4 text-2xl sm:text-3xl">
            {messages.title}
          </h1>
          {item.competitionName ? (
            <p className="mt-2 font-semibold text-muted">
              {item.competitionName}
            </p>
          ) : null}
          <Scoreboard match={item.match} />
          <p className="mt-4 text-center text-sm text-muted">
            {formatDate(item.match.kickoffAt, locale, {
              dateStyle: "full",
              timeStyle: "short",
            })}
          </p>
          <p className="game-inset mt-5 p-4 leading-6">
            {presentation.description}
          </p>
          {presentation.href ? (
            <Link
              href={presentation.href}
              className="button-primary mt-5 inline-flex min-h-11 w-full items-center justify-center px-4 py-3 font-bold"
            >
              {presentation.action}
            </Link>
          ) : null}
        </div>
      </article>
      <GoalSummary match={item.match} messages={messages} />
      <Link
        href="/matches"
        className="button-secondary mt-6 inline-flex min-h-11 items-center px-4 py-3 font-bold"
      >
        {messages.back}
      </Link>
    </>
  );
}
