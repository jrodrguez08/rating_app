"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { Messages } from "@/i18n/messages";
import { getBallotStatus } from "@/lib/firebase/ballot-client";

import { CheckIcon, WhatsAppIcon } from "./game-icons";

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
      <span
        className={`score-font inline-flex min-h-8 max-w-full items-center gap-2 border border-success/50 bg-success/10 px-2 py-1 text-[0.6875rem] uppercase tracking-[0.03em] text-success ${shareHref ? "" : compact ? "mt-3" : "mt-5"}`}
        role="status"
      >
        <CheckIcon aria-hidden="true" className="shrink-0" />
        <span>{messages.submitted}</span>
      </span>,
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
    <div className="mt-5 flex max-w-full flex-wrap items-center gap-3">
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
