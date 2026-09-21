"use client";

import { useEffect, useState } from "react";

import type {
  VoteComparison,
  VoteComparisonRow,
} from "@/domain/vote-comparison";
import type { Locale } from "@/i18n/config";
import { formatRating } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { getVoterIdToken } from "@/lib/firebase/voter-auth";

type State = "loading" | "no_ballot" | "unavailable" | VoteComparison;

export function VoteComparisonSection({
  matchId,
  locale,
  messages,
}: {
  matchId: string;
  locale: Locale;
  messages: Messages["results"]["comparison"];
}) {
  const [state, setState] = useState<State>("loading");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const token = await getVoterIdToken();
        const response = await fetch(
          `/api/matches/${encodeURIComponent(matchId)}/vote-comparison`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
        );
        const payload: unknown = await response.json();
        if (!active) return;
        if (
          response.ok &&
          typeof payload === "object" &&
          payload !== null &&
          "status" in payload &&
          payload.status === "ready" &&
          "comparison" in payload &&
          isComparison(payload.comparison)
        )
          setState(payload.comparison);
        else if (
          response.ok &&
          typeof payload === "object" &&
          payload !== null &&
          "status" in payload &&
          payload.status === "no_ballot"
        )
          setState("no_ballot");
        else setState("unavailable");
      } catch {
        if (active) setState("unavailable");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [matchId]);

  return (
    <section
      aria-labelledby="vote-comparison-heading"
      className="mt-7 border-t-2 border-border pt-6"
    >
      <h2 id="vote-comparison-heading" className="score-font text-xl">
        {messages.title}
      </h2>
      {typeof state === "string" ? (
        <p className="mt-3 text-sm text-muted" role="status">
          {state === "loading"
            ? messages.loading
            : state === "no_ballot"
              ? messages.noBallot
              : messages.unavailable}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">{messages.description}</p>
          <p className="mt-1 text-xs text-muted">{messages.differenceNote}</p>
          <table className="mt-4 w-full table-fixed border-t-2 border-border text-[11px] sm:text-sm">
            <colgroup>
              <col className="w-[41%]" />
              <col className="w-[19%]" />
              <col className="w-[20%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="py-2 pr-1 text-left font-normal">
                  {messages.player}
                </th>
                <th scope="col" className="px-0.5 py-2 text-right font-normal">
                  <span aria-hidden="true">{messages.yourShort}</span>
                  <span className="sr-only">{messages.yourRating}</span>
                </th>
                <th scope="col" className="px-0.5 py-2 text-right font-normal">
                  {messages.community}
                </th>
                <th scope="col" className="pl-0.5 py-2 text-right font-normal">
                  <span aria-hidden="true">Δ</span>
                  <span className="sr-only">{messages.difference}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.players.map((player) => (
                <ComparisonRow
                  key={player.id}
                  row={player}
                  locale={locale}
                  messages={messages}
                />
              ))}
            </tbody>
            <tbody>
              <tr className="border-t-2 border-border">
                <th
                  scope="rowgroup"
                  colSpan={4}
                  className="pt-3 pb-1 text-left font-bold"
                >
                  {messages.coach}
                </th>
              </tr>
              <ComparisonRow
                row={state.coach}
                locale={locale}
                messages={messages}
              />
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function ComparisonRow({
  row,
  locale,
  messages,
}: {
  row: VoteComparisonRow;
  locale: Locale;
  messages: Messages["results"]["comparison"];
}) {
  const rounded = Math.round(row.difference * 10) / 10;
  const difference = rounded === 0 ? 0 : rounded;
  const signed = `${difference > 0 ? "+" : ""}${formatRating(difference, locale)}`;
  const relation =
    difference > 0
      ? messages.above
      : difference < 0
        ? messages.below
        : messages.equal;
  const tone =
    difference > 0
      ? "text-success"
      : difference < 0
        ? "text-warning"
        : "text-muted";
  return (
    <tr className="border-b border-border/60 align-top last:border-b-0">
      <th
        scope="row"
        className="min-w-0 py-2 pr-1 text-left font-bold [overflow-wrap:anywhere]"
      >
        {row.name}
      </th>
      <td className="score-font whitespace-nowrap px-0.5 py-2 text-right">
        {formatRating(row.userRating, locale)}
      </td>
      <td className="score-font whitespace-nowrap px-0.5 py-2 text-right">
        {formatRating(row.communityAverage, locale)}
      </td>
      <td
        className={`score-font whitespace-nowrap pl-0.5 py-2 text-right ${tone}`}
      >
        <span aria-hidden="true">{signed}</span>
        <span className="sr-only">
          {signed} {relation}
        </span>
      </td>
    </tr>
  );
}

function isComparison(value: unknown): value is VoteComparison {
  if (
    typeof value !== "object" ||
    value === null ||
    !("players" in value) ||
    !("coach" in value)
  )
    return false;
  return (
    Array.isArray(value.players) &&
    value.players.every(isRow) &&
    isRow(value.coach)
  );
}

function isRow(value: unknown): value is VoteComparisonRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "userRating" in value &&
    typeof value.userRating === "number" &&
    Number.isFinite(value.userRating) &&
    "communityAverage" in value &&
    typeof value.communityAverage === "number" &&
    Number.isFinite(value.communityAverage) &&
    "difference" in value &&
    typeof value.difference === "number" &&
    Number.isFinite(value.difference)
  );
}
