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
        <StudioViewTabs
          tabs={tabs}
          view={view}
          setView={setView}
          label={messages.viewsLabel}
          idPrefix="studio"
          panelId="studio-presentation-panel"
          active={!fullscreen}
          variant="page"
        />
      </section>

      <div
        ref={presentationRef}
        id="studio-presentation-panel"
        role="tabpanel"
        aria-labelledby={`${fullscreen ? "studio-fullscreen" : "studio"}-${view}-tab`}
        className="relative mt-5 min-w-0 max-w-full overflow-hidden bg-background"
      >
        <div
          hidden={!fullscreen}
          className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b-2 border-border bg-surface p-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-3"
        >
          <p className="score-font min-w-0 truncate text-xs text-accent sm:text-sm">
            {messages.title}
          </p>
          <StudioViewTabs
            tabs={tabs}
            view={view}
            setView={setView}
            label={messages.viewsLabel}
            idPrefix="studio-fullscreen"
            panelId="studio-presentation-panel"
            active={fullscreen}
            variant="fullscreen"
          />
          <button
            type="button"
            className="button-secondary min-h-11 px-3 py-2 text-sm sm:col-start-3 sm:row-start-1"
            onClick={toggleFullscreen}
          >
            {messages.exitFullscreen}
          </button>
        </div>
        <StudioBoard
          presentation={presentation}
          locale={locale}
          messages={messages}
          view={view}
        />
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

function StudioViewTabs({
  tabs,
  view,
  setView,
  label,
  idPrefix,
  panelId,
  active,
  variant,
}: {
  tabs: ReadonlyArray<{ id: StudioView; label: string }>;
  view: StudioView;
  setView: (view: StudioView) => void;
  label: string;
  idPrefix: string;
  panelId: string;
  active: boolean;
  variant: "page" | "fullscreen";
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const wasActive = useRef(active);
  const selectedIndex = tabs.findIndex((tab) => tab.id === view);

  useEffect(() => {
    if (active && !wasActive.current) {
      tabRefs.current[selectedIndex]?.focus();
    }
    wasActive.current = active;
  }, [active, selectedIndex]);

  function selectTab(index: number) {
    const nextIndex = (index + tabs.length) % tabs.length;
    setView(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      hidden={!active}
      className={
        variant === "page"
          ? "mt-5 grid grid-cols-1 border-2 border-border bg-surface sm:grid-cols-3"
          : "col-span-2 row-start-2 grid min-w-0 grid-cols-3 border-2 border-border bg-background sm:col-span-1 sm:col-start-2 sm:row-start-1"
      }
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-${tab.id}-tab`}
          aria-selected={view === tab.id}
          aria-controls={panelId}
          tabIndex={active && view === tab.id ? 0 : -1}
          className={`score-font min-h-11 min-w-0 break-words border-b-4 px-2 py-2 text-[0.65rem] sm:px-3 sm:text-xs lg:text-sm ${view === tab.id ? "border-accent bg-panel text-accent" : "border-transparent text-muted"}`}
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
  );
}

function formatOption(match: StudioMatchOption, locale: Locale): string {
  return `${formatDate(match.kickoffAt, locale, { dateStyle: "medium" })} · ${match.homeTeamName} ${match.score.home} - ${match.score.away} ${match.awayTeamName}`;
}
