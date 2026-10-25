"use client";

import { useState } from "react";

import type { Messages } from "@/i18n/messages";

type ShareStatus =
  | "idle"
  | "sharing"
  | "preparing_story"
  | "shared"
  | "copied"
  | "story_ready"
  | "cancelled"
  | "error";

export function ResultSharing({
  canonicalUrl,
  storyUrl,
  storyFilename,
  shareTitle,
  shareText,
  messages,
}: {
  canonicalUrl: string;
  storyUrl: string;
  storyFilename: string;
  shareTitle: string;
  shareText: string;
  messages: Messages["results"]["sharing"];
}) {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [showManualCopy, setShowManualCopy] = useState(false);
  const busy = status === "sharing" || status === "preparing_story";

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

  async function shareStory() {
    setStatus("preparing_story");
    try {
      const response = await fetch(storyUrl, { credentials: "omit" });
      if (!response.ok) throw new Error("Story image is unavailable.");
      const blob = await response.blob();
      const file = new File([blob], storyFilename, { type: "image/png" });
      const shareData = { files: [file], title: shareTitle, text: shareText };
      if (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare(shareData)
      ) {
        try {
          await navigator.share(shareData);
          setStatus("shared");
          return;
        } catch (error) {
          if (isAbortError(error)) {
            setStatus("cancelled");
            return;
          }
        }
      }
      if (downloadBlob(blob, storyFilename)) {
        setStatus("story_ready");
        return;
      }
      window.open(storyUrl, "_blank", "noopener,noreferrer");
      setStatus("story_ready");
    } catch {
      window.open(storyUrl, "_blank", "noopener,noreferrer");
      setStatus("error");
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
        <button
          type="button"
          className="button-secondary min-h-11 px-4 py-3 font-bold"
          disabled={busy}
          onClick={() => void shareStory()}
        >
          {status === "preparing_story"
            ? messages.preparingStory
            : messages.shareStory}
        </button>
      </div>
      <a
        href={storyUrl}
        className="mt-3 inline-flex min-h-11 items-center font-bold text-accent underline decoration-2 underline-offset-4"
        download={storyFilename}
      >
        {messages.downloadStory}
      </a>
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

function downloadBlob(blob: Blob, filename: string): boolean {
  if (
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return false;
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  return true;
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
    case "preparing_story":
      return messages.preparingStory;
    case "shared":
      return messages.shared;
    case "copied":
      return messages.copied;
    case "story_ready":
      return messages.storyReady;
    case "cancelled":
      return messages.cancelled;
    case "error":
      return messages.error;
    default:
      return "";
  }
}
