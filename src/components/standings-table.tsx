import type { StandingsViewModel } from "@/application/standings";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

interface StandingsTableProps {
  standings: StandingsViewModel | null;
  locale: Locale;
  messages: Messages["standings"];
}

export function StandingsTable({
  standings,
  locale,
  messages,
}: StandingsTableProps) {
  if (standings === null) {
    return (
      <section
        className="card p-5 text-center"
        aria-labelledby="standings-title"
      >
        <p className="eyebrow">{messages.eyebrow}</p>
        <h1 id="standings-title" className="score-font mt-2 text-2xl">
          {messages.title}
        </h1>
        <p className="mt-3 text-muted">{messages.unavailable}</p>
        <p className="mt-2 text-sm text-muted">{messages.periodic}</p>
      </section>
    );
  }
  const updated = formatDate(standings.providerSyncedAt, locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section aria-labelledby="standings-title">
      <p className="eyebrow">{messages.eyebrow}</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 id="standings-title" className="score-font text-2xl sm:text-3xl">
            {messages.title}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {standings.competitionName} · {standings.seasonName}
          </p>
        </div>
        <p className="text-xs text-muted">
          {messages.updated.replace("{date}", updated)}
        </p>
      </div>
      <p className="mt-3 text-sm text-muted">{messages.periodic}</p>
      <div className="card mt-5 overflow-hidden">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="bg-surface-raised text-xs uppercase text-muted">
            <tr>
              <th scope="col" className="w-8 px-1 py-3 text-center">
                {messages.rank}
              </th>
              <th scope="col" className="px-1 py-3 text-left">
                {messages.team}
              </th>
              <th scope="col" className="w-9 px-1 py-3 text-center">
                <abbr title={messages.playedTitle}>{messages.played}</abbr>
              </th>
              <th
                scope="col"
                className="hidden w-9 px-1 py-3 text-center sm:table-cell"
              >
                <abbr title={messages.wonTitle}>{messages.won}</abbr>
              </th>
              <th
                scope="col"
                className="hidden w-9 px-1 py-3 text-center sm:table-cell"
              >
                <abbr title={messages.drawnTitle}>{messages.drawn}</abbr>
              </th>
              <th
                scope="col"
                className="hidden w-9 px-1 py-3 text-center sm:table-cell"
              >
                <abbr title={messages.lostTitle}>{messages.lost}</abbr>
              </th>
              <th scope="col" className="w-9 px-1 py-3 text-center">
                <abbr title={messages.goalDifferenceTitle}>
                  {messages.goalDifference}
                </abbr>
              </th>
              <th scope="col" className="w-10 px-1 py-3 text-center">
                <abbr title={messages.pointsTitle}>{messages.points}</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.rows.map((row) => (
              <tr
                key={row.externalTeamId}
                className={
                  row.trackedTeam
                    ? "border-l-4 border-accent bg-brand/15"
                    : "border-l-4 border-transparent"
                }
              >
                <td className="score-font border-t border-border px-1 py-3 text-center">
                  {row.rank}
                </td>
                <th
                  scope="row"
                  className="truncate border-t border-border px-1 py-3 text-left font-bold"
                  title={row.teamName}
                >
                  {row.teamName}
                  {row.trackedTeam ? (
                    <span className="sr-only"> — {messages.trackedTeam}</span>
                  ) : null}
                </th>
                <td className="border-t border-border px-1 py-3 text-center">
                  {row.played}
                </td>
                <td className="hidden border-t border-border px-1 py-3 text-center sm:table-cell">
                  {row.won}
                </td>
                <td className="hidden border-t border-border px-1 py-3 text-center sm:table-cell">
                  {row.drawn}
                </td>
                <td className="hidden border-t border-border px-1 py-3 text-center sm:table-cell">
                  {row.lost}
                </td>
                <td className="score-font border-t border-border px-1 py-3 text-center">
                  {row.goalDifference > 0 ? "+" : ""}
                  {row.goalDifference}
                </td>
                <td className="score-font border-t border-border px-1 py-3 text-center text-accent">
                  {row.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
