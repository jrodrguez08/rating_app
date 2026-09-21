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
          <ul className="mt-4 space-y-2">
            {state.players.map((player) => (
              <ComparisonItem
                key={player.id}
                row={player}
                locale={locale}
                messages={messages}
              />
            ))}
          </ul>
          <h3 className="score-font mt-6 text-base">{messages.coach}</h3>
          <ul className="mt-3">
            <ComparisonItem
              row={state.coach}
              locale={locale}
              messages={messages}
            />
          </ul>
        </>
      )}
    </section>
  );
}

function ComparisonItem({
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
  return (
    <li className="game-inset min-w-0 p-3">
      <p className="break-words font-bold">{row.name}</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <p>
          {messages.yourRating}{" "}
          <span className="score-font">
            {formatRating(row.userRating, locale)}
          </span>
        </p>
        <p>
          {messages.community}{" "}
          <span className="score-font">
            {formatRating(row.communityAverage, locale)}
          </span>
        </p>
      </div>
      <p className="mt-2 text-sm text-muted">
        <span className="score-font text-foreground">{signed}</span> {relation}
      </p>
    </li>
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
