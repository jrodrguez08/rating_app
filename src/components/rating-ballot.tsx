"use client";

import { useEffect, useRef, useState } from "react";

import type { BallotContext, BallotRatings } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { getBallotStatus, submitBallot } from "@/lib/firebase/ballot-client";

type BallotMessages = Messages["ballot"];

export function RatingBallot({
  context,
  locale,
  messages,
}: {
  context: BallotContext;
  locale: Locale;
  messages: BallotMessages;
}) {
  const [status, setStatus] = useState<
    "checking" | "editing" | "confirming" | "submitting" | "submitted" | "error"
  >("checking");
  const [error, setError] = useState<string | null>(null);
  const [playerRatings, setPlayerRatings] = useState<Record<string, number>>(
    {},
  );
  const [coachRating, setCoachRating] = useState<number>();
  const submitReference = useRef<HTMLButtonElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const confirmationButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void getBallotStatus(context.matchId)
      .then((result) =>
        setStatus(result === "submitted" ? "submitted" : "editing"),
      )
      .catch(() => {
        setError(messages.sessionError);
        setStatus("error");
      });
  }, [context.matchId, messages.sessionError]);
  useEffect(() => {
    if (status === "confirming") confirmationHeading.current?.focus();
  }, [status]);

  if (status === "checking") {
    return <p className="game-inset p-4 text-muted">{messages.checking}</p>;
  }
  if (status === "submitted") {
    return <SubmittedState messages={messages} />;
  }

  const completed = Object.keys(playerRatings).length + (coachRating ? 1 : 0);
  const total = context.players.length + 1;
  const complete = completed === total;

  async function confirmSubmission() {
    if (!complete || coachRating === undefined) {
      setError(messages.invalidError);
      setStatus("editing");
      return;
    }
    setStatus("submitting");
    setError(null);
    const ratings: BallotRatings = {
      playerRatings,
      coachRating: { coachId: context.coach.id, rating: coachRating },
    };
    try {
      const result = await submitBallot(context.matchId, ratings);
      if (result === "created" || result === "already_submitted") {
        setStatus("submitted");
      } else {
        const resultMessages: Partial<Record<typeof result, string>> = {
          invalid_ballot: messages.invalidError,
          closed: messages.closedDescription,
          not_open: messages.notOpenDescription,
          data_unavailable: messages.unavailableDescription,
          unauthorized: messages.sessionError,
        };
        setError(resultMessages[result] ?? messages.submitError);
        setStatus("editing");
      }
    } catch {
      setError(messages.submitError);
      setStatus("editing");
    }
  }

  return (
    <>
      <section
        className="card overflow-hidden"
        aria-labelledby="ballot-heading"
      >
        <div aria-hidden="true" className="flex h-2">
          <span className="w-3/4 bg-brand" />
          <span className="w-1/4 bg-accent" />
        </div>
        <div className="px-4 py-5 sm:px-6">
          <p className="eyebrow">{messages.eyebrow}</p>
          <h1 id="ballot-heading" className="mt-3 text-3xl font-extrabold">
            {messages.title}
          </h1>
          <p className="score-font mt-4 text-center text-xl text-accent">
            {context.homeTeamName} {score(context, messages.versus)}{" "}
            {context.awayTeamName}
          </p>
          <p className="mt-3 text-center text-sm text-muted">
            {replace(messages.closes, {
              time: formatDate(context.votingClosesAt, locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
        </div>
      </section>

      <section className="mt-6" aria-labelledby="players-heading">
        <h2 id="players-heading" className="score-font text-xl">
          {messages.players}
        </h2>
        <div className="mt-3 space-y-4">
          {context.players.map((player) => (
            <RatingRow
              key={player.id}
              name={player.name}
              detail={player.substitute ? messages.substitute : player.position}
              label={replace(messages.ratingLabel, { name: player.name })}
              value={playerRatings[player.id]}
              onChange={(rating) =>
                setPlayerRatings((current) => ({
                  ...current,
                  [player.id]: rating,
                }))
              }
            />
          ))}
        </div>
      </section>

      <section className="mt-7" aria-labelledby="coach-heading">
        <h2 id="coach-heading" className="score-font text-xl">
          {messages.coach}
        </h2>
        <div className="mt-3">
          <RatingRow
            name={context.coach.name}
            label={replace(messages.ratingLabel, { name: context.coach.name })}
            value={coachRating}
            onChange={setCoachRating}
          />
        </div>
      </section>

      <div className="card sticky bottom-3 mt-7 p-4">
        <p aria-live="polite" className="score-font text-center text-lg">
          {replace(messages.progress, {
            completed: String(completed),
            total: String(total),
          })}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button
          ref={submitReference}
          type="button"
          disabled={!complete || status === "submitting"}
          className="button-primary mt-3 min-h-11 w-full px-4 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setStatus("confirming")}
        >
          {status === "submitting" ? messages.submitting : messages.submit}
        </button>
      </div>

      {status === "confirming" ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirmation-heading"
            aria-describedby="confirmation-description"
            className="card w-full max-w-md p-5"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setStatus("editing");
                queueMicrotask(() => submitReference.current?.focus());
              } else if (event.key === "Tab") {
                const activeElement = document.activeElement;
                if (
                  event.shiftKey &&
                  (activeElement === confirmationHeading.current ||
                    activeElement === confirmationButton.current)
                ) {
                  event.preventDefault();
                  cancelButton.current?.focus();
                } else if (
                  !event.shiftKey &&
                  activeElement === cancelButton.current
                ) {
                  event.preventDefault();
                  confirmationButton.current?.focus();
                }
              }
            }}
          >
            <h2
              ref={confirmationHeading}
              tabIndex={-1}
              id="confirmation-heading"
              className="score-font text-2xl"
            >
              {messages.confirmTitle}
            </h2>
            <p
              id="confirmation-description"
              className="mt-3 leading-6 text-muted"
            >
              {messages.confirmDescription}
            </p>
            <button
              ref={confirmationButton}
              type="button"
              className="button-primary mt-5 min-h-11 w-full px-4 py-3 font-bold"
              onClick={() => void confirmSubmission()}
            >
              {messages.confirm}
            </button>
            <button
              ref={cancelButton}
              type="button"
              className="button-secondary mt-3 min-h-11 w-full px-4 py-3 font-bold"
              onClick={() => {
                setStatus("editing");
                queueMicrotask(() => submitReference.current?.focus());
              }}
            >
              {messages.cancel}
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}

function RatingRow({
  name,
  detail,
  label,
  value,
  onChange,
}: {
  name: string;
  detail?: string;
  label: string;
  value?: number;
  onChange: (rating: number) => void;
}) {
  return (
    <fieldset className="card p-4">
      <legend className="w-full px-1 text-base font-bold">
        {name}
        {detail ? (
          <span className="ml-2 text-xs font-medium uppercase text-muted">
            {detail}
          </span>
        ) : null}
      </legend>
      <div className="mt-3 grid grid-cols-5 gap-2" aria-label={label}>
        {Array.from({ length: 10 }, (_, index) => index + 1).map((rating) => (
          <button
            key={rating}
            type="button"
            aria-label={`${label}: ${rating}`}
            aria-pressed={value === rating}
            onClick={() => onChange(rating)}
            className={`score-font min-h-11 border-2 text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
              value === rating
                ? "border-accent bg-accent text-background shadow-[2px_2px_0_var(--game-shadow)]"
                : "border-border bg-surface text-foreground"
            }`}
          >
            {rating}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function SubmittedState({ messages }: { messages: BallotMessages }) {
  return (
    <section
      className="card p-6 text-center"
      aria-labelledby="submitted-heading"
    >
      <span className="status-badge">{messages.submittedTitle}</span>
      <h2 id="submitted-heading" className="score-font mt-4 text-2xl">
        {messages.submittedTitle}
      </h2>
      <p className="mt-3 text-muted">{messages.submittedDescription}</p>
    </section>
  );
}

function score(context: BallotContext, versus: string): string {
  return context.score.home === null || context.score.away === null
    ? versus
    : `${context.score.home} - ${context.score.away}`;
}

function replace(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, value),
    template,
  );
}
