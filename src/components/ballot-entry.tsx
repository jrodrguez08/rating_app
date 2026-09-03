"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { Messages } from "@/i18n/messages";
import { getBallotStatus } from "@/lib/firebase/ballot-client";

import { WhatsAppIcon } from "./game-icons";

export function BallotEntry({
  matchId,
  messages,
  compact = false,
  shareHref,
}: {
  matchId: string;
  messages: Messages["home"]["matchLifecycle"]["ready"];
  compact?: boolean;
  shareHref?: string;
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
    return actionRow(
      <p className={`${shareHref ? "" : "mt-5"} text-sm text-muted`}>
        {messages.checking}
      </p>,
      shareHref,
      messages.share,
    );
  }
  if (state === "submitted") {
    return actionRow(
      <div
        className={`game-inset ${compact ? `${shareHref ? "" : "mt-3"} px-3 py-2` : `${shareHref ? "" : "mt-5"} p-3`}`}
        role="status"
      >
        <p className="status-badge">{messages.submitted}</p>
        <p className="mt-1 text-sm text-muted">
          {messages.submittedDescription}
        </p>
      </div>,
      shareHref,
      messages.share,
    );
  }
  if (state === "error") {
    return actionRow(
      <p className={`${shareHref ? "" : "mt-5"} text-sm text-danger`}>
        {messages.sessionError}
      </p>,
      shareHref,
      messages.share,
    );
  }
  return actionRow(
    <Link
      href={`/matches/${encodeURIComponent(matchId)}/rate`}
      className={
        compact
          ? `${shareHref ? "" : "mt-2"} inline-flex min-h-11 items-center font-bold text-accent underline decoration-2 underline-offset-4`
          : `button-primary ${shareHref ? "" : "mt-5"} inline-flex min-h-11 items-center justify-center px-5 py-3 font-bold`
      }
    >
      {messages.action}
    </Link>,
    shareHref,
    messages.share,
  );
}

function actionRow(
  content: ReactNode,
  shareHref: string | undefined,
  shareLabel: string,
) {
  if (!shareHref) return content;

  return (
    <div className="mt-5 flex items-center gap-3">
      <div className="min-w-0">{content}</div>
      {shareHref ? (
        <a
          href={shareHref}
          aria-label={shareLabel}
          title={shareLabel}
          target="_blank"
          rel="noopener noreferrer"
          className="button-secondary inline-flex size-11 shrink-0 items-center justify-center text-muted hover:text-foreground"
        >
          <WhatsAppIcon aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}
