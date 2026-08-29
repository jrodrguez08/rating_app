import Link from "next/link";

import type { Match, MatchResult, PlayerResult } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

export function MatchResults({
  match,
  result,
  locale,
  messages,
}: {
  match: Match;
  result: MatchResult;
  locale: Locale;
  messages: Messages["results"];
}) {
  const ranked = Object.values(result.playerResults).sort(compareResults);
  const ballotLabel =
    result.ballotCount === 1
      ? messages.basedOnOne
      : messages.basedOnMany.replace("{count}", String(result.ballotCount));
  return (
    <section aria-labelledby="results-heading" className="card overflow-hidden">
      <div aria-hidden="true" className="flex h-2">
        <span className="w-3/4 bg-brand" />
        <span className="w-1/4 bg-accent" />
      </div>
      <div className="px-4 py-6 sm:px-7 sm:py-8">
        <p className="eyebrow">{messages.eyebrow}</p>
        <h1 id="results-heading" className="score-font mt-3 text-3xl">
          {messages.title}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {formatDate(match.kickoffAt, locale, { dateStyle: "medium" })}
        </p>
        <div className="game-inset mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4 text-center">
          <TeamName name={match.homeTeam.name} />
          <div>
            <p className="score-font text-xs text-accent">{messages.final}</p>
            <p className="score-font mt-1 text-3xl">
              {match.score.home} - {match.score.away}
            </p>
          </div>
          <TeamName name={match.awayTeam.name} />
        </div>
        {result.status === "no_votes" ? (
          <div className="game-inset mt-5 p-5 text-center">
            <h2 className="score-font text-xl">{messages.noVotesTitle}</h2>
            <p className="mt-2 text-muted">{messages.noVotesDescription}</p>
          </div>
        ) : (
          <>
            <div className="mt-5 border-2 border-accent bg-surface p-5 text-center shadow-[4px_4px_0_var(--game-shadow)]">
              <p className="score-font text-sm text-accent">
                {result.mvpPlayerIds.length > 1 ? messages.coMvp : messages.mvp}
              </p>
              {result.mvpPlayerIds.map((id) => (
                <p key={id} className="mt-2 break-words text-lg font-extrabold">
                  {result.playerResults[id].playerName}
                  <span className="score-font ml-3 text-3xl text-accent">
                    {rating(result.playerResults[id].average)}
                  </span>
                </p>
              ))}
            </div>
            <h2 className="score-font mt-7 text-xl">{messages.players}</h2>
            <ol className="mt-3 space-y-2">
              {ranked.map((player, index) => (
                <li
                  key={player.playerId}
                  className="game-inset grid grid-cols-[2rem_1fr_auto] items-center gap-3 p-3"
                >
                  <span className="score-font text-muted">{index + 1}</span>
                  <span className="min-w-0 break-words font-bold">
                    {player.playerName}
                    {player.position ? (
                      <small className="block font-normal text-muted">
                        {player.position}
                      </small>
                    ) : null}
                  </span>
                  <span
                    className="score-font text-2xl text-accent"
                    aria-label={messages.rating
                      .replace("{name}", player.playerName)
                      .replace("{rating}", rating(player.average))}
                  >
                    {rating(player.average)}
                  </span>
                </li>
              ))}
            </ol>
            <div className="card mt-7 p-5">
              <h2 className="score-font text-xl">{messages.coach}</h2>
              <div className="mt-3 flex items-center justify-between gap-4">
                <p className="break-words font-bold">
                  {result.coachResult.coachName}
                </p>
                <span className="score-font text-3xl text-accent">
                  {rating(result.coachResult.average)}
                </span>
              </div>
            </div>
          </>
        )}
        <p className="mt-5 text-center text-sm text-muted">{ballotLabel}</p>
        <Link
          href="/"
          className="button-secondary mt-5 inline-flex min-h-11 w-full items-center justify-center px-4 py-3 font-bold"
        >
          {messages.backHome}
        </Link>
      </div>
    </section>
  );
}

export function ResultRouteState({
  state,
  messages,
}: {
  state: "locked" | "preparing" | "unavailable";
  messages: Messages["results"];
}) {
  const content =
    state === "locked"
      ? [messages.lockedTitle, messages.lockedDescription]
      : state === "preparing"
        ? [messages.preparingTitle, messages.preparingDescription]
        : [messages.unavailableTitle, messages.unavailableDescription];
  return (
    <section
      className="card p-6 text-center"
      aria-labelledby="result-state-heading"
    >
      <h1 id="result-state-heading" className="score-font text-2xl">
        {content[0]}
      </h1>
      <p className="mt-3 leading-6 text-muted">{content[1]}</p>
      <Link
        href="/"
        className="button-secondary mt-5 inline-flex min-h-11 items-center px-4 py-3 font-bold"
      >
        {messages.backHome}
      </Link>
    </section>
  );
}

function compareResults(left: PlayerResult, right: PlayerResult) {
  return (
    right.average - left.average ||
    left.order - right.order ||
    left.playerId.localeCompare(right.playerId)
  );
}

function rating(value: number) {
  return value.toFixed(1);
}

function TeamName({ name }: { name: string }) {
  return <p className="min-w-0 break-words text-sm font-bold">{name}</p>;
}
