import type { Match, MatchGoalEvent } from "@/domain/models";
import type { Messages } from "@/i18n/messages";

type GoalMessages = Pick<
  Messages["matches"],
  "goal" | "goalByTeam" | "goals" | "opponentGoal" | "trackedTeamGoal"
>;

export function GoalSummary({
  match,
  messages,
  compact = false,
}: {
  match: Match;
  messages: GoalMessages;
  compact?: boolean;
}) {
  const events = match.goalEvents ?? [];
  if (events.length === 0) return null;
  const trackedExternalId = match.trackedTeamExternalProviderId;
  if (compact) {
    const orientedEvents = chronologicalGoals(events).flatMap(
      ({ event, originalIndex }) => {
        const home = event.externalTeamId === match.homeTeam.externalProviderId;
        const away = event.externalTeamId === match.awayTeam.externalProviderId;
        if (home === away) return [];
        return [
          {
            event,
            originalIndex,
            side: home ? ("home" as const) : ("away" as const),
            teamName: home ? match.homeTeam.name : match.awayTeam.name,
          },
        ];
      },
    );
    if (orientedEvents.length === 0) return null;
    return (
      <section aria-label={messages.goals} className="mt-4">
        <h2 className="score-font text-sm text-muted">{messages.goals}</h2>
        <ol className="mt-2 space-y-2">
          {orientedEvents.map(({ event, originalIndex, side, teamName }) => {
            const scorerName =
              typeof event.scorerName === "string"
                ? event.scorerName.trim()
                : "";
            const visibleName = scorerName || teamName;
            const minute = formatGoalMinute(event);
            const teamAnnouncement = messages.goalByTeam.replace(
              "{team}",
              teamName,
            );
            const announcement = scorerName
              ? `${teamAnnouncement}, ${scorerName}, ${minute}`
              : `${teamAnnouncement}, ${minute}`;
            return (
              <li
                key={`${event.externalTeamId}-${event.externalPlayerId}-${event.elapsed}-${event.extra ?? 0}-${originalIndex}`}
                aria-label={announcement}
                data-goal-side={side}
                className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] text-sm"
              >
                {side === "home" ? (
                  <GoalHalf side="home" name={visibleName} minute={minute} />
                ) : (
                  <span data-goal-half="home" aria-hidden="true" />
                )}
                <span aria-hidden="true" className="bg-border" />
                {side === "away" ? (
                  <GoalHalf side="away" name={visibleName} minute={minute} />
                ) : (
                  <span data-goal-half="away" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  return (
    <section aria-labelledby="goal-summary-heading" className="card mt-6 p-5">
      <h2 id="goal-summary-heading" className="score-font text-xl">
        {messages.goals}
      </h2>
      <ol className="mt-3 space-y-2">
        {events.map((event, originalIndex) => {
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
              key={`${event.externalTeamId}-${event.externalPlayerId}-${event.elapsed}-${event.extra ?? 0}-${originalIndex}`}
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

function chronologicalGoals(events: MatchGoalEvent[]) {
  return events
    .map((event, originalIndex) => ({ event, originalIndex }))
    .filter(
      ({ event }) =>
        typeof event.externalTeamId === "string" &&
        Number.isFinite(event.elapsed) &&
        event.elapsed >= 0,
    )
    .sort(
      (left, right) =>
        left.event.elapsed - right.event.elapsed ||
        (left.event.extra ?? 0) - (right.event.extra ?? 0) ||
        left.originalIndex - right.originalIndex,
    );
}

function GoalHalf({
  side,
  name,
  minute,
}: {
  side: "home" | "away";
  name: string;
  minute: string;
}) {
  return (
    <span
      data-goal-half={side}
      aria-hidden="true"
      className={`game-inset flex min-w-0 items-center gap-1 px-2 py-2 ${
        side === "home"
          ? "justify-end border-r-0 text-right"
          : "justify-start border-l-0 text-left"
      }`}
    >
      {side === "home" ? (
        <>
          <span className="min-w-0 break-words font-bold">{name}</span>
          <span>·</span>
          <span className="score-font shrink-0 text-accent">{minute}</span>
        </>
      ) : (
        <>
          <span className="score-font shrink-0 text-accent">{minute}</span>
          <span>·</span>
          <span className="min-w-0 break-words font-bold">{name}</span>
        </>
      )}
    </span>
  );
}
