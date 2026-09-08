import Link from "next/link";

import type {
  PlayerCatalog,
  PlayerCatalogEntry,
} from "@/application/player-history";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

import { PlayerAvatar } from "./player-avatar";

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
                <PlayerAvatar
                  name={player.playerName}
                  photoUrl={player.photoUrl}
                  label={messages.avatarLabel.replace(
                    "{name}",
                    player.playerName,
                  )}
                />
                <span className="min-w-0">
                  <span className="block break-words font-extrabold">
                    {player.playerName}
                  </span>
                  {player.position === undefined ? null : (
                    <span className="mt-1 block text-sm font-bold text-accent">
                      {messages.positions[player.position]}
                    </span>
                  )}
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
                <span className="text-right">
                  <span className="score-font block text-xs text-muted">
                    {player.rank === null
                      ? messages.unranked
                      : `#${player.rank}`}
                  </span>
                  <span className="score-font block text-2xl text-accent">
                    {player.overallAverage === null
                      ? "—"
                      : rating(player.overallAverage)}
                  </span>
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
          <div className="flex items-center gap-4">
            <PlayerAvatar
              name={player.playerName}
              photoUrl={player.photoUrl}
              size="profile"
              label={messages.avatarLabel.replace("{name}", player.playerName)}
            />
            <div className="min-w-0">
              <p className="eyebrow">{messages.teamContext}</p>
              <h1
                id="player-heading"
                className="mt-2 break-words text-3xl font-extrabold"
              >
                {player.playerName}
              </h1>
              {player.position === undefined ? null : (
                <p className="mt-1 font-bold text-accent">
                  {messages.positions[player.position]}
                </p>
              )}
            </div>
          </div>
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
              <RatingSparkline
                player={player}
                locale={locale}
                messages={messages}
              />
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
  locale,
  messages,
}: {
  player: PlayerCatalogEntry;
  locale: Locale;
  messages: PlayerMessages;
}) {
  const chronological = [...player.history].reverse();
  const plot = {
    left: 28,
    right: 312,
    top: 12,
    bottom: 116,
  };
  const plotted = chronological.map((entry, index) => ({
    entry,
    x:
      plot.left +
      (index / (chronological.length - 1)) * (plot.right - plot.left),
    y: ratingToY(entry.average, plot.top, plot.bottom),
  }));
  const points = plotted.map(({ x, y }) => `${x},${y}`).join(" ");
  const labeledPointIndexes = axisLabelIndexes(chronological.length);
  const label = messages.trendLabel
    .replace("{name}", player.playerName)
    .replace(
      "{ratings}",
      chronological.map((entry) => rating(entry.average)).join(", "),
    );
  return (
    <div className="game-inset mt-4 overflow-hidden p-3">
      <svg
        viewBox="0 0 320 152"
        role="group"
        aria-label={label}
        className="h-44 w-full max-w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{label}</title>
        <g aria-hidden="true">
          {[
            { rating: 10, y: plot.top },
            { rating: 5, y: ratingToY(5, plot.top, plot.bottom) },
            { rating: 1, y: plot.bottom },
          ].map((guide) => (
            <g key={guide.rating}>
              <text
                x="21"
                y={guide.y}
                dy="0.35em"
                textAnchor="end"
                fill="var(--game-muted)"
                fontSize="10"
              >
                {guide.rating}
              </text>
              <line
                data-testid="rating-guide"
                x1={plot.left}
                x2={plot.right}
                y1={guide.y}
                y2={guide.y}
                stroke="var(--game-border)"
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity="0.55"
              />
            </g>
          ))}
        </g>
        <polyline
          points={points}
          fill="none"
          stroke="var(--club-secondary)"
          strokeWidth="4"
          strokeLinejoin="miter"
        />
        {plotted.map(({ entry, x, y }, index) => {
          const shortDate = formatDate(entry.kickoffAt, locale, {
            day: "numeric",
            month: "numeric",
          });
          const fullDate = formatDate(entry.kickoffAt, locale, {
            dateStyle: "medium",
          });
          const pointLabel = messages.trendPointLabel
            .replace("{opponent}", entry.opponentName)
            .replace("{date}", fullDate)
            .replace("{rating}", rating(entry.average));
          const tooltipWidth = 152;
          const tooltipHeight = 50;
          const tooltipX = Math.min(
            Math.max(x - tooltipWidth / 2, plot.left),
            316 - tooltipWidth,
          );
          const tooltipY =
            y < plot.top + tooltipHeight + 8 ? y + 10 : y - tooltipHeight - 8;
          return (
            <g
              key={entry.matchId}
              data-testid="rating-point"
              role="img"
              aria-label={pointLabel}
              tabIndex={0}
              focusable="true"
              className="group outline-none"
            >
              <circle cx={x} cy={y} r="12" fill="transparent" />
              <circle
                cx={x}
                cy={y}
                r="8"
                fill="none"
                stroke="var(--game-focus)"
                strokeWidth="2"
                className="opacity-0 group-focus:opacity-100"
              />
              <circle
                cx={x}
                cy={y}
                r="4"
                fill="var(--club-primary)"
                stroke="var(--game-text)"
                strokeWidth="2"
              />
              <g
                aria-hidden="true"
                className="pointer-events-none opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100 motion-reduce:transition-none"
              >
                <rect
                  x={tooltipX}
                  y={tooltipY}
                  width={tooltipWidth}
                  height={tooltipHeight}
                  fill="var(--game-surface-raised)"
                  stroke="var(--game-text)"
                  strokeWidth="1"
                />
                <text
                  x={tooltipX + 7}
                  y={tooltipY + 15}
                  fill="var(--club-secondary)"
                  fontSize="11"
                  className="score-font"
                >
                  {messages.trendRating.replace(
                    "{rating}",
                    rating(entry.average),
                  )}
                </text>
                <text
                  x={tooltipX + 7}
                  y={tooltipY + 29}
                  fill="var(--game-text)"
                  fontSize="10"
                >
                  {truncate(
                    messages.versus.replace("{opponent}", entry.opponentName),
                    24,
                  )}
                </text>
                <text
                  x={tooltipX + 7}
                  y={tooltipY + 42}
                  fill="var(--game-muted)"
                  fontSize="9"
                >
                  {fullDate}
                </text>
              </g>
              {labeledPointIndexes.has(index) ? (
                <g aria-hidden="true">
                  <line
                    x1={x}
                    x2={x}
                    y1={plot.bottom}
                    y2={plot.bottom + 4}
                    stroke="var(--game-muted)"
                    strokeWidth="1"
                  />
                  <text
                    data-testid="rating-axis-label"
                    x={x}
                    y="139"
                    textAnchor={
                      index === 0
                        ? "start"
                        : index === chronological.length - 1
                          ? "end"
                          : "middle"
                    }
                    fill="var(--game-muted)"
                    fontSize="9"
                  >
                    {shortDate}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ratingToY(value: number, top: number, bottom: number) {
  return bottom - ((value - 1) / 9) * (bottom - top);
}

function axisLabelIndexes(length: number) {
  if (length <= 5) return new Set(Array.from({ length }, (_, index) => index));
  return new Set([
    0,
    Math.round((length - 1) / 3),
    Math.round(((length - 1) * 2) / 3),
    length - 1,
  ]);
}

function truncate(value: string, maximumLength: number) {
  return value.length <= maximumLength
    ? value
    : `${value.slice(0, maximumLength - 1)}…`;
}

function matchCount(count: number, messages: PlayerMessages) {
  return count === 1
    ? messages.ratedMatch
    : messages.ratedMatches.replace("{count}", String(count));
}

function rating(value: number) {
  return value.toFixed(1);
}
