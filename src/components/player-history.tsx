import Link from "next/link";

import type {
  PlayerCatalog,
  PlayerCatalogEntry,
} from "@/application/player-history";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

type PlayerMessages = Messages["players"];

export function PlayerCatalogView({
  catalog,
  messages,
}: {
  catalog: PlayerCatalog;
  messages: PlayerMessages;
}) {
  return (
    <section aria-labelledby="players-heading">
      <p className="eyebrow">{messages.eyebrow}</p>
      <h1 id="players-heading" className="score-font mt-2 text-3xl">
        {messages.title}
      </h1>
      <p className="mt-3 max-w-2xl leading-6 text-muted">
        {messages.introduction}
      </p>
      {catalog.players.length === 0 ? (
        <p className="game-inset mt-6 p-5 text-center text-muted">
          {messages.noPlayers}
        </p>
      ) : (
        <ol className="mt-6 space-y-3">
          {catalog.players.map((player) => (
            <li key={player.playerId}>
              <Link
                href={`/players/${encodeURIComponent(player.playerId)}`}
                className="card grid min-h-20 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 p-4"
              >
                <span className="score-font text-center text-lg text-muted">
                  {player.rank === null ? "—" : `#${player.rank}`}
                </span>
                <span className="min-w-0">
                  <span className="block break-words font-extrabold">
                    {player.playerName}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {matchCount(player.ratedMatchCount, messages)}
                    {player.rank === null ? ` · ${messages.unranked}` : ""}
                  </span>
                  {player.recentRating === null ? null : (
                    <span className="mt-1 block text-xs text-muted">
                      {messages.recentRating.replace(
                        "{rating}",
                        rating(player.recentRating),
                      )}
                    </span>
                  )}
                </span>
                <span className="score-font text-2xl text-accent">
                  {player.overallAverage === null
                    ? "—"
                    : rating(player.overallAverage)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function PlayerProfile({
  player,
  locale,
  messages,
}: {
  player: PlayerCatalogEntry;
  locale: Locale;
  messages: PlayerMessages;
}) {
  return (
    <>
      <section
        className="card overflow-hidden"
        aria-labelledby="player-heading"
      >
        <div aria-hidden="true" className="flex h-2">
          <span className="w-3/4 bg-brand" />
          <span className="w-1/4 bg-accent" />
        </div>
        <div className="p-5 sm:p-7">
          <p className="eyebrow">{messages.teamContext}</p>
          <h1
            id="player-heading"
            className="mt-2 break-words text-3xl font-extrabold"
          >
            {player.playerName}
          </h1>
          <div className="game-inset mt-5 grid grid-cols-2 gap-4 p-4">
            <div>
              <p className="score-font text-4xl text-accent">
                {player.overallAverage === null
                  ? "—"
                  : rating(player.overallAverage)}
              </p>
              <p className="mt-1 text-sm text-muted">{messages.average}</p>
            </div>
            <div className="text-right">
              <p className="score-font text-xl">
                {player.rank === null
                  ? messages.unranked
                  : messages.rank.replace("{rank}", String(player.rank))}
              </p>
              <p className="mt-1 text-sm text-muted">
                {matchCount(player.ratedMatchCount, messages)}
              </p>
            </div>
          </div>
          {player.rank === null && player.ratedMatchCount > 0 ? (
            <p className="mt-3 text-sm text-muted">
              {messages.unrankedDescription.replace("{count}", "2")}
            </p>
          ) : null}
        </div>
      </section>

      {player.history.length === 0 ? (
        <section className="game-inset mt-6 p-5 text-center">
          <p className="text-muted">{messages.noHistory}</p>
        </section>
      ) : (
        <>
          <section
            className="card mt-6 p-5"
            aria-labelledby="evolution-heading"
          >
            <h2 id="evolution-heading" className="score-font text-xl">
              {messages.evolution}
            </h2>
            {player.history.length === 1 ? (
              <div className="game-inset mt-4 p-4 text-center">
                <p className="score-font text-3xl text-accent">
                  {rating(player.history[0].average)}
                </p>
                <p className="mt-2 text-sm text-muted">
                  {messages.oneMatchTrend}
                </p>
              </div>
            ) : (
              <RatingSparkline player={player} messages={messages} />
            )}
          </section>

          <section className="mt-7" aria-labelledby="recent-ratings-heading">
            <h2 id="recent-ratings-heading" className="score-font text-xl">
              {messages.recentMatches}
            </h2>
            <ol className="mt-3 space-y-3">
              {player.history.map((entry) => (
                <li key={entry.matchId} className="game-inset p-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
                    <div>
                      <time
                        className="text-xs text-muted"
                        dateTime={entry.kickoffAt}
                      >
                        {formatDate(entry.kickoffAt, locale, {
                          dateStyle: "medium",
                        })}
                      </time>
                      <p className="mt-1 break-words font-bold">
                        {messages.versus.replace(
                          "{opponent}",
                          entry.opponentName,
                        )}
                      </p>
                      <p className="score-font mt-1 text-sm text-muted">
                        {entry.homeTeamName} {entry.score.home} -{" "}
                        {entry.score.away} {entry.awayTeamName}
                      </p>
                    </div>
                    <span className="score-font text-3xl text-accent">
                      {rating(entry.average)}
                    </span>
                  </div>
                  <Link
                    href={`/matches/${encodeURIComponent(entry.matchId)}/results`}
                    className="mt-2 inline-flex min-h-11 items-center font-bold text-accent underline decoration-2 underline-offset-4"
                  >
                    {messages.viewResults}&nbsp;→
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
      <Link
        href="/players"
        className="button-secondary mt-7 inline-flex min-h-11 items-center px-4 py-3 font-bold"
      >
        {messages.back}
      </Link>
    </>
  );
}

function RatingSparkline({
  player,
  messages,
}: {
  player: PlayerCatalogEntry;
  messages: PlayerMessages;
}) {
  const chronological = [...player.history].reverse();
  const points = chronological
    .map((entry, index) => {
      const x = 8 + (index / (chronological.length - 1)) * 184;
      const y = 92 - ((entry.average - 1) / 9) * 84;
      return `${x},${y}`;
    })
    .join(" ");
  const label = messages.trendLabel
    .replace("{name}", player.playerName)
    .replace(
      "{ratings}",
      chronological.map((entry) => rating(entry.average)).join(", "),
    );
  return (
    <div className="game-inset mt-4 p-3">
      <svg
        viewBox="0 0 200 100"
        role="img"
        aria-label={label}
        className="h-32 w-full"
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--club-secondary)"
          strokeWidth="4"
          strokeLinejoin="miter"
        />
        {chronological.map((entry, index) => {
          const [cx, cy] = points.split(" ")[index].split(",");
          return (
            <circle
              key={entry.matchId}
              cx={cx}
              cy={cy}
              r="4"
              fill="var(--club-primary)"
              stroke="var(--game-text)"
              strokeWidth="2"
            />
          );
        })}
      </svg>
    </div>
  );
}

function matchCount(count: number, messages: PlayerMessages) {
  return count === 1
    ? messages.ratedMatch
    : messages.ratedMatches.replace("{count}", String(count));
}

function rating(value: number) {
  return value.toFixed(1);
}
