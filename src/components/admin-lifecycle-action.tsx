"use client";

import { useState, type FormEvent } from "react";

import type { Messages } from "@/i18n/messages";
import { formatDate } from "@/i18n/format";
import type { AdminMatchOperation } from "@/lib/firebase/admin-console";
import type { AdminLifecycleAction } from "@/lib/server/admin-lifecycle-action";

type AdminMessages = Messages["admin"];

interface LifecycleReceipt {
  auditId: string;
  status: keyof AdminMessages["lifecycleStatuses"];
  retryable: boolean;
  statusCheckAvailable: boolean;
  retryAfter?: string;
  lifecycleAction?: string;
}

export function AdminLifecycleActionPanel({
  match,
  messages,
  teamId,
}: {
  match: AdminMatchOperation;
  messages: AdminMessages;
  teamId: string;
}) {
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const [receipt, setReceipt] = useState<LifecycleReceipt | null>(null);
  const action: AdminLifecycleAction = {
    matchId: match.id,
    trackedTeamId: teamId,
    externalFixtureId: match.externalFixtureId,
  };
  const eligible =
    ["live", "finished"].includes(match.status) &&
    ["not_ready", "preparing_rating"].includes(match.ratingState);

  async function post(path: string, body: unknown) {
    setError("");
    const csrf = document.cookie
      .split("; ")
      .find((item) => item.startsWith("rating_admin_csrf="))
      ?.split("=")[1];
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-CSRF": csrf ?? "",
      },
      body: JSON.stringify(body),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
          ? result.error
          : messages.genericError,
      );
    }
    return result as Record<string, unknown>;
  }

  async function createPreview() {
    setBusy(true);
    try {
      const result = await post("/api/admin/lifecycle/preview", action);
      setPreview(result.plan as Record<string, unknown>);
      setPreviewToken(String(result.previewToken));
      setAuthorized(false);
      setConfirmation("");
      setReceipt(null);
      setOutcome("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await post("/api/admin/lifecycle/authorize", {
        action,
        previewToken,
        passphrase: String(new FormData(event.currentTarget).get("passphrase")),
      });
      event.currentTarget.reset();
      setAuthorized(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const result = await post("/api/admin/lifecycle/apply", {
        action,
        confirmation,
      });
      acceptReceipt(result.receipt);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    setBusy(true);
    try {
      const result = await post("/api/admin/lifecycle/status", action);
      acceptReceipt(result.receipt);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  function acceptReceipt(value: unknown) {
    if (!isLifecycleReceipt(value)) throw new Error(messages.genericError);
    setReceipt(value);
    setOutcome(
      `${messages.lifecycleRequestAccepted} ${messages.audit}: ${value.auditId} · ${messages.lifecycleResult}: ${messages.lifecycleStatuses[value.status]}${
        value.lifecycleAction
          ? ` ${displayLifecycleAction(value.lifecycleAction, messages)}.`
          : ""
      }`,
    );
    if (!value.retryable) {
      setAuthorized(false);
      setPreview(null);
    }
  }

  return (
    <section className="card grid gap-4 p-5" aria-labelledby="readiness-title">
      <div>
        <p className="eyebrow">{messages.readinessEyebrow}</p>
        <h2 id="readiness-title" className="score-font mt-2 text-xl">
          {messages.readinessTitle}
        </h2>
      </div>
      <dl className="game-inset grid gap-2 p-4 text-sm sm:grid-cols-2">
        <ReadinessItem
          label={messages.confirmedStarters}
          value={`${match.confirmedStarterCount}/11`}
        />
        <ReadinessItem
          label={messages.confirmedSubstitutes}
          value={String(match.confirmedSubstituteCount)}
        />
        <ReadinessItem
          label={messages.unconfirmedOrUnused}
          value={String(match.unconfirmedOrUnusedCount)}
        />
        <ReadinessItem
          label={messages.coachReadiness}
          value={match.headCoachReady ? messages.ready : messages.pending}
        />
        <ReadinessItem
          label={messages.lineupProvenance}
          value={messages.provenance[match.lineupProvenance]}
        />
        <ReadinessItem
          label={messages.lastProviderSync}
          value={displayTime(match.lastProviderSyncAt, messages)}
        />
        <ReadinessItem
          label={messages.lastLifecycleExecution}
          value={displayTime(match.lastLifecycleCompletedAt, messages)}
        />
        <ReadinessItem
          label={messages.lifecycleExecutionSource}
          value={
            match.lastLifecycleTrigger
              ? messages.lifecycleTriggers[match.lastLifecycleTrigger]
              : messages.none
          }
        />
        <ReadinessItem
          label={messages.lifecycleExecutionOutcome}
          value={
            match.lastLifecycleAction
              ? displayLifecycleAction(match.lastLifecycleAction, messages)
              : messages.none
          }
        />
        <ReadinessItem
          label={messages.providerRequestCount}
          value={
            match.lastLifecycleProviderRequests === undefined
              ? messages.none
              : String(match.lastLifecycleProviderRequests)
          }
        />
        <ReadinessItem
          label={messages.ftObserved}
          value={displayTime(match.finishedObservedAt, messages)}
        />
        <ReadinessItem
          label={messages.participantEvidenceAt}
          value={displayTime(match.participantSyncedAt, messages)}
        />
        <ReadinessItem
          label={messages.votingReadyAt}
          value={displayTime(match.ratingReadyAt, messages)}
        />
        <ReadinessItem
          label={messages.ftToOpenDelay}
          value={duration(
            match.finishedObservedAt,
            match.votingOpensAt,
            messages,
          )}
        />
        <ReadinessItem
          label={messages.evidenceDelay}
          value={duration(
            match.finishedObservedAt,
            match.participantSyncedAt,
            messages,
          )}
        />
      </dl>
      <p className="text-muted text-sm">{messages.readinessHelp}</p>
      {eligible && !preview ? (
        <button
          className="button-primary min-h-11 px-4"
          disabled={busy}
          onClick={createPreview}
        >
          {busy ? messages.loading : messages.requestLifecycle}
        </button>
      ) : null}
      {preview ? (
        <div className="grid gap-4">
          <p className="text-sm">{messages.lifecyclePreview}</p>
          <form className="grid gap-3" onSubmit={authorize}>
            <label className="grid gap-2">
              <span>{messages.passphrase}</span>
              <input
                className="game-inset min-h-11 px-3"
                name="passphrase"
                type="password"
                autoComplete="off"
                required
              />
            </label>
            <button className="button-secondary min-h-11 px-4" disabled={busy}>
              {messages.authorize}
            </button>
          </form>
          {authorized ? (
            <div className="grid gap-3">
              <label className="grid gap-2">
                <span>{messages.confirmation}</span>
                <input
                  className="game-inset min-h-11 px-3"
                  placeholder={`request-lifecycle:${match.id}`}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              {!receipt ||
              (receipt.retryable &&
                (receipt.status === "failed" ||
                  receipt.status === "skipped_busy")) ? (
                <button
                  className="button-primary min-h-11 px-4"
                  type="button"
                  disabled={busy}
                  onClick={apply}
                >
                  {receipt
                    ? messages.retryLifecycle
                    : messages.requestLifecycle}
                </button>
              ) : null}
              {receipt?.statusCheckAvailable ? (
                <button
                  className="button-secondary min-h-11 px-4"
                  type="button"
                  disabled={busy}
                  onClick={checkStatus}
                >
                  {messages.checkLifecycleStatus}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="border-danger text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {outcome ? (
        <p
          className={
            receipt?.status === "completed" || receipt?.status === "voting_open"
              ? "border-success text-success"
              : "text-warning"
          }
          role="status"
        >
          {outcome}
        </p>
      ) : null}
    </section>
  );
}

function ReadinessItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}

function displayTime(value: string | undefined, messages: AdminMessages) {
  return value
    ? formatDate(value, "es", { dateStyle: "short", timeStyle: "medium" })
    : messages.none;
}

function duration(
  start: string | undefined,
  end: string | undefined,
  messages: AdminMessages,
) {
  if (!start || !end) return messages.notMeasured;
  const milliseconds = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    return messages.notMeasured;
  return messages.minutes.replace(
    "{count}",
    String(Math.round(milliseconds / 60_000)),
  );
}

function displayLifecycleAction(action: string, messages: AdminMessages) {
  return action in messages.lifecycleActions
    ? messages.lifecycleActions[
        action as keyof typeof messages.lifecycleActions
      ]
    : messages.lifecycleActions.retryable_error;
}

function isLifecycleReceipt(value: unknown): value is LifecycleReceipt {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.auditId === "string" &&
    typeof candidate.retryable === "boolean" &&
    typeof candidate.statusCheckAvailable === "boolean" &&
    [
      "requested",
      "running",
      "skipped_busy",
      "completed",
      "failed",
      "voting_open",
    ].includes(String(candidate.status)) &&
    (candidate.retryAfter === undefined ||
      typeof candidate.retryAfter === "string") &&
    (candidate.lifecycleAction === undefined ||
      typeof candidate.lifecycleAction === "string")
  );
}
