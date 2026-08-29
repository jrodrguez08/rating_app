"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Messages } from "@/i18n/messages";
import { getBallotStatus } from "@/lib/firebase/ballot-client";

export function BallotEntry({
  matchId,
  messages,
}: {
  matchId: string;
  messages: Messages["home"]["matchLifecycle"]["ready"];
}) {
  const [state, setState] = useState<
    "checking" | "available" | "submitted" | "error"
  >("checking");
  useEffect(() => {
    void getBallotStatus(matchId)
      .then((status) =>
        setState(status === "submitted" ? "submitted" : "available"),
      )
      .catch(() => setState("error"));
  }, [matchId]);

  if (state === "checking") {
    return <p className="mt-5 text-sm text-muted">{messages.checking}</p>;
  }
  if (state === "submitted") {
    return (
      <p className="game-inset mt-5 p-3 font-semibold">{messages.submitted}</p>
    );
  }
  if (state === "error") {
    return <p className="mt-5 text-sm text-danger">{messages.sessionError}</p>;
  }
  return (
    <Link
      href={`/matches/${encodeURIComponent(matchId)}/rate`}
      className="button-primary mt-5 inline-flex min-h-11 items-center justify-center px-5 py-3 font-bold"
    >
      {messages.action}
    </Link>
  );
}
