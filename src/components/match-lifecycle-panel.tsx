import type { Match } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

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
      <div className="px-5 py-6 sm:px-7 sm:py-8">
        <span className="status-badge">{state.label}</span>
        <h2
          id="match-status-heading"
          className="score-font mt-5 text-2xl leading-tight text-foreground sm:text-3xl"
        >
          {state.title}
        </h2>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
          <TeamName name={match.homeTeam.name} />
          <span className="score-font text-2xl text-accent sm:text-3xl">
            {showScore
              ? `${match.score.home} - ${match.score.away}`
              : messages.versus}
          </span>
          <TeamName name={match.awayTeam.name} />
        </div>
        <p className="mt-5 text-center text-sm leading-6 text-muted">
          {formatDate(match.kickoffAt, locale, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        <p className="game-inset mt-5 border-l-2 border-l-accent p-3 text-sm font-medium leading-6 text-foreground">
          {state.description}
        </p>
      </div>
    </section>
  );
}

function TeamName({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <div className="min-w-0">
      <span
        aria-hidden="true"
        className="score-font mx-auto flex h-10 w-10 items-center justify-center border-2 border-border bg-surface text-sm text-foreground"
      >
        {initials}
      </span>
      <p className="mt-2 break-words text-sm font-semibold leading-5 text-foreground">
        {name}
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
    };
  }
  if (match.status === "live") {
    return {
      label: messages.live.label,
      title: messages.live.title,
      description: messages.live.description,
    };
  }
  if (match.status === "finished" || match.ratingState === "preparing_rating") {
    return {
      label: messages.preparing.label,
      title: messages.preparing.title,
      description: messages.preparing.description,
    };
  }
  return {
    label: messages.upcoming.label,
    title: messages.upcoming.title,
    description: messages.upcoming.description,
  };
}
