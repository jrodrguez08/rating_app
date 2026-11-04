"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { clubPath, type Club } from "@/config/club";
import type { Messages } from "@/i18n/messages";
import { getBallotStatus } from "@/lib/firebase/ballot-client";

import { SubmittedState } from "./rating-ballot";

export function BallotRouteState({
  club,
  matchId,
  state,
  messages,
}: {
  club: Club;
  matchId: string;
  state: "not_open" | "closed" | "unavailable";
  messages: Messages["ballot"];
}) {
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    void getBallotStatus(club, matchId)
      .then((status) => setSubmitted(status === "submitted"))
      .catch(() => undefined);
  }, [club, matchId]);
  if (submitted) return <SubmittedState messages={messages} />;
  const content =
    state === "closed"
      ? [messages.closedTitle, messages.closedDescription]
      : state === "not_open"
        ? [messages.notOpenTitle, messages.notOpenDescription]
        : [messages.unavailableTitle, messages.unavailableDescription];
  return (
    <section
      className="card p-6 text-center"
      aria-labelledby="ballot-state-heading"
    >
      <h1 id="ballot-state-heading" className="score-font text-2xl">
        {content[0]}
      </h1>
      <p className="mt-3 leading-6 text-muted">{content[1]}</p>
      <Link
        href={clubPath(club)}
        className="button-secondary mt-5 inline-flex min-h-11 items-center px-4 py-3 font-bold"
      >
        {messages.backHome}
      </Link>
    </section>
  );
}
