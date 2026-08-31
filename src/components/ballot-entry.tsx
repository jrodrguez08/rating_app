"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Messages } from "@/i18n/messages";
import { getBallotStatus } from "@/lib/firebase/ballot-client";

export function BallotEntry({
  matchId,
  messages,
  compact = false,
}: {
  matchId: string;
  messages: Messages["home"]["matchLifecycle"]["ready"];
  compact?: boolean;
}) {
  const [state, setState] = useState<
    "checking" | "available" | "submitted" | "error"
  >("checking");
  useEffect(() => {
    void getBallotStatus(matchId)
      .then((status) => {
        if (status === "submitted") setState("submitted");
        else if (status === "available") setState("available");
        else setState("error");
      })
      .catch(() => setState("error"));
  }, [matchId]);

  if (state === "checking") {
    return <p className="mt-5 text-sm text-muted">{messages.checking}</p>;
  }
  if (state === "submitted") {
    return (
      <div
        className={`game-inset ${compact ? "mt-3 px-3 py-2" : "mt-5 p-3"}`}
        role="status"
      >
        <p className="status-badge">{messages.submitted}</p>
        <p className="mt-1 text-sm text-muted">
          {messages.submittedDescription}
        </p>
      </div>
    );
  }
  if (state === "error") {
    return <p className="mt-5 text-sm text-danger">{messages.sessionError}</p>;
  }
  return (
    <Link
      href={`/matches/${encodeURIComponent(matchId)}/rate`}
      className={
        compact
          ? "mt-2 inline-flex min-h-11 items-center font-bold text-accent underline decoration-2 underline-offset-4"
          : "button-primary mt-5 inline-flex min-h-11 items-center justify-center px-5 py-3 font-bold"
      }
    >
      {messages.action}
    </Link>
  );
}
