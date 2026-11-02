"use client";

import { useState } from "react";

import type { Messages } from "@/i18n/messages";

type ShareStatus =
  "idle" | "sharing" | "shared" | "copied" | "cancelled" | "error";

export function ResultSharing({
  canonicalUrl,
  storyUrl,
  storyFilename,
  ratingStoryPages,
  shareTitle,
  shareText,
  messages,
}: {
  canonicalUrl: string;
  storyUrl: string;
  storyFilename: string;
  ratingStoryPages: readonly {
    page: number;
    pageCount: number;
    url: string;
    filename: string;
  }[];
  shareTitle: string;
  shareText: string;
  messages: Messages["results"]["sharing"];
}) {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [showManualCopy, setShowManualCopy] = useState(false);
  const busy = status === "sharing";

  async function copyLink() {
    setStatus("sharing");
    if (await copyText(canonicalUrl)) {
      setShowManualCopy(false);
      setStatus("copied");
      return;
    }
    setShowManualCopy(true);
    setStatus("error");
  }

  async function shareResults() {
    setShowManualCopy(false);
    setStatus("sharing");
    if (typeof navigator.share !== "function") {
      await copyLink();
      return;
    }
    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: canonicalUrl,
      });
      setStatus("shared");
    } catch (error) {
      setStatus(isAbortError(error) ? "cancelled" : "error");
    }
  }

  return (
    <section
      aria-labelledby="result-sharing-heading"
      className="game-inset mt-7 p-4 sm:p-5"
    >
      <h2 id="result-sharing-heading" className="score-font text-xl">
        {messages.title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        {messages.description}
      </p>
      <button
        type="button"
        className="button-primary mt-4 min-h-11 w-full px-4 py-3 font-bold"
        disabled={busy}
        onClick={() => void shareResults()}
      >
        {status === "sharing" ? messages.sharing : messages.shareResults}
      </button>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="button-secondary min-h-11 px-4 py-3 font-bold"
          disabled={busy}
          onClick={() => void copyLink()}
        >
          {messages.copyLink}
        </button>
        <a
          href={storyUrl}
          download={storyFilename}
          className="button-secondary inline-flex min-h-11 items-center justify-center px-4 py-3 font-bold"
        >
          {messages.downloadStory}
        </a>
      </div>
      <a
        href={`${storyUrl}?view=1`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex min-h-11 items-center font-bold text-accent underline decoration-2 underline-offset-4"
      >
        {messages.viewStory}
      </a>
      <div className="mt-5 border-t-2 border-[var(--game-border)] pt-4">
        <h3 className="score-font text-lg">{messages.tableStoryTitle}</h3>
        <p className="mt-2 text-sm leading-6 text-muted">
          {messages.tableStoryDescription}
        </p>
        <ul className="mt-3 space-y-3" aria-label={messages.tableStoryTitle}>
          {ratingStoryPages.map((storyPage) => {
            const multiple = storyPage.pageCount > 1;
            return (
              <li key={storyPage.page} className="grid gap-3 sm:grid-cols-2">
                <a
                  href={storyPage.url}
                  download={storyPage.filename}
                  className="button-secondary inline-flex min-h-11 items-center justify-center px-4 py-3 text-center font-bold"
                >
                  {multiple
                    ? pageLabel(
                        messages.downloadTableStoryPage,
                        storyPage.page,
                        storyPage.pageCount,
                      )
                    : messages.downloadTableStory}
                </a>
                <a
                  href={`${storyPage.url}&view=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center text-center font-bold text-accent underline decoration-2 underline-offset-4"
                >
                  {multiple
                    ? pageLabel(
                        messages.viewTableStoryPage,
                        storyPage.page,
                        storyPage.pageCount,
                      )
                    : messages.viewTableStory}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      {showManualCopy ? (
        <label className="mt-3 block text-sm font-bold">
          {messages.copyUnavailable}
          <input
            className="mt-2 min-h-11 w-full border-2 border-[var(--game-border)] bg-[var(--game-background)] px-3 text-[var(--game-text)]"
            value={canonicalUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      ) : null}
      <p
        className="mt-3 min-h-6 text-sm text-muted"
        role="status"
        aria-live="polite"
      >
        {statusMessage(status, messages)}
      </p>
    </section>
  );
}

function pageLabel(template: string, page: number, pageCount: number): string {
  return template
    .replace("{page}", String(page))
    .replace("{total}", String(pageCount));
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Continue to the browser's legacy copy path.
  }
  if (typeof document.execCommand !== "function") return false;
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.remove();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function statusMessage(
  status: ShareStatus,
  messages: Messages["results"]["sharing"],
): string {
  switch (status) {
    case "sharing":
      return messages.sharing;
    case "shared":
      return messages.shared;
    case "copied":
      return messages.copied;
    case "cancelled":
      return messages.cancelled;
    case "error":
      return messages.error;
    default:
      return "";
  }
}
