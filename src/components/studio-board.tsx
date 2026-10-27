import type { CSSProperties } from "react";

import type { StudioMatchPresentation } from "@/application/studio";
import { initialClub } from "@/config/club";
import { getTeamBadgePresentation } from "@/config/team-badges";
import type { Locale } from "@/i18n/config";
import { formatDate, formatRating } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

import { PlayerAvatar } from "./player-avatar";
import { TeamBadge } from "./team-badge";

export type StudioView = "podium" | "ranking" | "radiography";

export function StudioBoard({
  presentation,
  locale,
  messages,
  view,
  overlay = false,
}: {
  presentation: StudioMatchPresentation;
  locale: Locale;
  messages: Messages["studio"];
  view: StudioView;
  overlay?: boolean;
}) {
  const { match, result, podium } = presentation;
  const style = {
    "--club-primary": initialClub.theme.primary,
    "--club-secondary": initialClub.theme.accent,
  } as CSSProperties;
  return (
    <article
      style={style}
      className={`studio-board relative isolate flex min-h-[34rem] min-w-0 max-w-full flex-col overflow-hidden bg-background text-foreground ${overlay ? "h-screen min-h-0 w-screen" : "border-2 border-border shadow-[6px_6px_0_var(--game-shadow)]"}`}
      aria-label={`${match.homeTeam.name} ${podium.score.home} - ${podium.score.away} ${match.awayTeam.name}`}
    >
      <div aria-hidden="true" className="flex h-2 shrink-0">
        <span className="w-3/4 bg-brand" />
        <span className="w-1/4 bg-accent" />
      </div>
      <div className="pointer-events-none absolute inset-5 -z-10 border border-white/5" />
      <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b-2 border-border bg-panel px-4 py-3 text-center sm:px-8">
        <StudioTeam team={match.homeTeam} />
        <div>
          <p className="score-font text-xs text-accent">{messages.final}</p>
          <p className="score-font mt-1 whitespace-nowrap text-3xl text-accent sm:text-5xl">
            {podium.score.home} - {podium.score.away}
          </p>
          <p className="mt-1 text-[0.65rem] font-bold text-muted sm:text-xs">
            {formatDate(match.kickoffAt, locale, { dateStyle: "medium" })}
          </p>
        </div>
        <StudioTeam team={match.awayTeam} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6 lg:p-8">
        {view === "podium" ? (
          <PodiumView
            presentation={presentation}
            locale={locale}
            messages={messages}
          />
        ) : view === "ranking" ? (
          <RankingView
            presentation={presentation}
            locale={locale}
            messages={messages}
          />
        ) : (
          <RadiographyView
            presentation={presentation}
            locale={locale}
            messages={messages}
          />
        )}
      </div>
      <footer className="score-font shrink-0 border-t border-border bg-panel px-4 py-2 text-center text-[0.65rem] text-muted sm:text-xs">
        Rating App · {ballotLabel(result.ballotCount, messages)}
      </footer>
    </article>
  );
}

function StudioTeam({
  team,
}: {
  team: StudioMatchPresentation["match"]["homeTeam"];
}) {
  return (
    <div className="min-w-0">
      <div className="hidden sm:block">
        <TeamBadge presentation={getTeamBadgePresentation(team)} />
      </div>
      <p className="mt-1 break-words text-xs font-extrabold leading-tight sm:text-base">
        {team.name}
      </p>
    </div>
  );
}

function PodiumView({ presentation, locale, messages }: BoardContentProps) {
  const { podium, result } = presentation;
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <p className="eyebrow text-center">
        {podium.topThree.filter(({ isMvp }) => isMvp).length > 1
          ? messages.jointMvp
          : messages.mvp}
      </p>
      <ol className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-3 sm:gap-4">
        {podium.topThree.map((player) => (
          <li
            key={player.playerId}
            className={`min-w-0 ${player.rank === 1 ? "sm:order-2" : player.rank === 2 ? "sm:order-1" : "sm:order-3"}`}
          >
            <div
              className={`mx-auto flex max-w-sm flex-col items-center border-2 bg-panel p-3 text-center shadow-[4px_4px_0_var(--game-shadow)] ${player.rank === 1 ? "border-accent sm:-translate-y-5" : "border-border"}`}
            >
              {player.isMvp ? (
                <span className="status-badge mb-2">{messages.mvp}</span>
              ) : null}
              <PlayerAvatar
                name={player.displayName}
                photoUrl={player.photoUrl}
                size="broadcast"
                label={messages.photoFor.replace("{name}", player.displayName)}
              />
              <p className="mt-3 max-w-full break-words font-extrabold leading-tight sm:text-lg">
                {player.displayName}
              </p>
              <p
                className="score-font mt-2 text-4xl text-accent sm:text-5xl"
                aria-label={messages.ratingFor
                  .replace("{name}", player.displayName)
                  .replace("{rating}", formatRating(player.average, locale))}
              >
                {formatRating(player.average, locale)}
              </p>
              <span className="score-font mt-2 text-sm text-muted">
                #{player.rank}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="mx-auto mt-4 flex w-full max-w-xl items-center justify-between gap-4 border-2 border-border bg-panel px-4 py-3">
        <div className="min-w-0">
          <p className="eyebrow">{messages.headCoach}</p>
          <p className="mt-1 break-words font-extrabold">
            {result.coachResult.coachName}
          </p>
        </div>
        <span className="score-font shrink-0 text-3xl text-accent">
          {formatRating(result.coachResult.average, locale)}
        </span>
      </div>
    </div>
  );
}

function RankingView({ presentation, locale, messages }: BoardContentProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
      <h2 className="score-font text-center text-xl text-accent sm:text-2xl">
        {messages.fullRanking}
      </h2>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {presentation.podium.players.map((player) => (
          <li
            key={player.playerId}
            className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 border border-border bg-panel p-2"
          >
            <span className="score-font w-6 text-center text-muted">
              {player.rank}
            </span>
            <PlayerAvatar
              name={player.displayName}
              photoUrl={player.photoUrl}
              label={messages.photoFor.replace("{name}", player.displayName)}
            />
            <span className="min-w-0 break-words text-sm font-extrabold sm:text-base">
              {player.displayName}
              {player.isMvp ? (
                <small className="score-font ml-2 text-accent">MVP</small>
              ) : null}
            </span>
            <span className="score-font text-2xl text-accent">
              {formatRating(player.average, locale)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RadiographyView({
  presentation,
  locale,
  messages,
}: BoardContentProps) {
  const { result, playerAverage, highestRatedPlayer, lowestRatedPlayer } =
    presentation;
  const cards = [
    {
      label: messages.ballots,
      value: String(result.ballotCount),
    },
    {
      label: messages.playerAverage,
      value: formatRating(playerAverage, locale),
      help: messages.playerAverageHelp,
    },
    {
      label: messages.headCoach,
      value: formatRating(result.coachResult.average, locale),
      name: result.coachResult.coachName,
    },
    {
      label: messages.highestRated,
      value: formatRating(highestRatedPlayer.average, locale),
      name: highestRatedPlayer.displayName,
    },
    {
      label: messages.lowestRated,
      value: formatRating(lowestRatedPlayer.average, locale),
      name: lowestRatedPlayer.displayName,
    },
  ];
  return (
    <dl className="m-auto grid w-full max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="border-2 border-border bg-panel p-4 text-center shadow-[3px_3px_0_var(--game-shadow)]"
        >
          <dt className="eyebrow">{card.label}</dt>
          <dd className="score-font mt-3 text-4xl text-accent sm:text-5xl">
            {card.value}
          </dd>
          {card.name ? (
            <dd className="mt-2 break-words font-extrabold">{card.name}</dd>
          ) : null}
          {card.help ? (
            <dd className="mt-2 text-xs leading-5 text-muted">{card.help}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

interface BoardContentProps {
  presentation: StudioMatchPresentation;
  locale: Locale;
  messages: Messages["studio"];
}

function ballotLabel(count: number, messages: Messages["studio"]): string {
  return count === 1
    ? messages.basedOnOne
    : messages.basedOnMany.replace("{count}", String(count));
}
