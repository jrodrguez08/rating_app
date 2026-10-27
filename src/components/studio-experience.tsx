"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type {
  StudioMatchOption,
  StudioMatchPresentation,
} from "@/application/studio";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

import { StudioBoard, type StudioView } from "./studio-board";

export function StudioExperience({
  presentation,
  matches,
  overlayUrl,
  locale,
  messages,
}: {
  presentation: StudioMatchPresentation;
  matches: StudioMatchOption[];
  overlayUrl: string;
  locale: Locale;
  messages: Messages["studio"];
}) {
  const router = useRouter();
  const [view, setView] = useState<StudioView>("podium");
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState<
    boolean | null
  >(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const presentationRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = [
    { id: "podium", label: messages.podiumTab },
    { id: "ranking", label: messages.rankingTab },
    { id: "radiography", label: messages.radiographyTab },
  ] as const;

  useEffect(() => {
    setFullscreenSupported(
      document.fullscreenEnabled === true &&
        typeof presentationRef.current?.requestFullscreen === "function",
    );
    const onFullscreenChange = () =>
      setFullscreen(document.fullscreenElement === presentationRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === presentationRef.current) {
        await document.exitFullscreen();
      } else if (presentationRef.current?.requestFullscreen) {
        await presentationRef.current.requestFullscreen();
      } else {
        setFullscreenSupported(false);
      }
    } catch {
      setFullscreenSupported(false);
    }
  }

  function selectTab(index: number) {
    const nextIndex = (index + tabs.length) % tabs.length;
    setView(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  async function copyOverlayUrl() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unavailable");
      await navigator.clipboard.writeText(overlayUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <>
      <section aria-labelledby="studio-heading">
        <p className="eyebrow">{messages.eyebrow}</p>
        <h1
          id="studio-heading"
          className="mt-3 text-3xl font-extrabold sm:text-4xl"
        >
          {messages.title}
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted">
          {messages.introduction}
        </p>
      </section>

      <section
        className="card mt-6 p-4 sm:p-5"
        aria-label={messages.viewsLabel}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,1fr)_auto] lg:items-end">
          <label className="min-w-0 font-bold" htmlFor="studio-match">
            {messages.selectMatch}
            <select
              id="studio-match"
              className="mt-2 min-h-11 w-full max-w-full border-2 border-border bg-background px-3 py-2 text-foreground"
              value={presentation.match.id}
              onChange={(event) =>
                router.push(
                  `/studio?match=${encodeURIComponent(event.target.value)}`,
                )
              }
            >
              {matches.map((match) => (
                <option key={match.matchId} value={match.matchId}>
                  {formatOption(match, locale)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button-secondary min-h-11 px-4 py-2"
            onClick={toggleFullscreen}
          >
            {messages.enterFullscreen}
          </button>
        </div>
        {fullscreenSupported === false ? (
          <p className="mt-3 text-sm leading-6 text-muted" role="status">
            {messages.fullscreenUnavailable}
          </p>
        ) : null}
        <div
          role="tablist"
          aria-label={messages.viewsLabel}
          className="mt-5 grid grid-cols-1 border-2 border-border bg-surface sm:grid-cols-3"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`studio-${tab.id}-tab`}
              aria-selected={view === tab.id}
              aria-controls="studio-presentation-panel"
              tabIndex={view === tab.id ? 0 : -1}
              className={`score-font min-h-11 border-b-4 px-3 py-2 ${view === tab.id ? "border-accent bg-panel text-accent" : "border-transparent text-muted"}`}
              onClick={() => setView(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  selectTab(index + 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectTab(index - 1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  selectTab(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  selectTab(tabs.length - 1);
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      <div
        ref={presentationRef}
        id="studio-presentation-panel"
        role="tabpanel"
        aria-labelledby={`studio-${view}-tab`}
        className="relative mt-5 min-w-0 max-w-full overflow-hidden bg-background"
      >
        <StudioBoard
          presentation={presentation}
          locale={locale}
          messages={messages}
          view={view}
        />
        {fullscreen ? (
          <button
            type="button"
            className="button-secondary absolute right-4 top-4 z-20 px-4 py-2"
            onClick={toggleFullscreen}
          >
            {messages.exitFullscreen}
          </button>
        ) : null}
      </div>

      <section
        className="card mt-6 p-4 sm:p-5"
        aria-labelledby="overlay-heading"
      >
        <h2 id="overlay-heading" className="score-font text-xl">
          {messages.overlayTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {messages.overlayHelp}
        </p>
        <label className="mt-4 block text-sm font-bold" htmlFor="overlay-url">
          {messages.overlayUrl}
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            id="overlay-url"
            readOnly
            value={overlayUrl}
            className="min-h-11 min-w-0 border-2 border-border bg-background px-3 py-2 text-foreground"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="button-primary px-4 py-2"
            onClick={copyOverlayUrl}
          >
            {messages.copyOverlay}
          </button>
        </div>
        <p
          className="mt-2 min-h-6 text-sm text-muted"
          role="status"
          aria-live="polite"
        >
          {copyStatus === "copied"
            ? messages.copiedOverlay
            : copyStatus === "error"
              ? messages.copyOverlayError
              : ""}
        </p>
      </section>
    </>
  );
}

function formatOption(match: StudioMatchOption, locale: Locale): string {
  return `${formatDate(match.kickoffAt, locale, { dateStyle: "medium" })} · ${match.homeTeamName} ${match.score.home} - ${match.score.away} ${match.awayTeamName}`;
}
