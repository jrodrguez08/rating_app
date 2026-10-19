"use client";

import { useState, type FormEvent } from "react";

import { manualVotingStatusEligibility } from "@/domain/manual-voting";
import type { Messages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";
import type { AdminManualVotingAction } from "@/lib/server/admin-manual-voting-action";

type AdminMessages = Messages["admin"];

interface PreviewPlan {
  providerStatus: string;
  verificationSource: string;
  proposedOpensAt: string;
  proposedClosesAt: string;
  durationMinutes: number;
  verifiedStarterCount: number;
  confirmedSubstituteCount: number;
  excludedSubstituteCount: number;
  verifiedCoachId: string;
  reconciliationStatus?: string;
}

export function AdminManualVotingPanel({
  detail,
  messages,
  teamId,
}: {
  detail: AdminMatchDetail;
  messages: AdminMessages;
  teamId: string;
}) {
  const [closeMode, setCloseMode] = useState<"default" | "custom">("default");
  const [customClosesAtLocal, setCustomClosesAtLocal] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PreviewPlan | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const action: AdminManualVotingAction = {
    matchId: detail.match.id,
    trackedTeamId: teamId,
    externalFixtureId: detail.match.externalFixtureId,
    finalWhistleConfirmed: true,
    verificationSource: source,
    verificationReason: reason,
    closeMode,
    ...(closeMode === "custom" ? { customClosesAtLocal } : {}),
  };
  const mutable = ["not_ready", "preparing_rating"].includes(
    detail.match.ratingState,
  );
  const hasVerifiedLineup =
    detail.match.lineupProvenance === "operator_verified";
  const hasVerifiedCoach =
    detail.match.verification !== undefined &&
    detail.match.assignment?.provenance === "operator_verified";
  const hasConflict = detail.reconciliation?.status === "conflict";
  const statusEligibility = manualVotingStatusEligibility(detail.match.status);
  const ready =
    mutable &&
    statusEligibility.allowed &&
    hasVerifiedLineup &&
    detail.match.confirmedStarterCount === 11 &&
    hasVerifiedCoach &&
    !hasConflict;

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

  function resetAuthorization() {
    setPreview(null);
    setAuthorized(false);
    setOutcome("");
  }

  async function createPreview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await post("/api/admin/manual-voting/preview", action);
      setPreview(result.plan as unknown as PreviewPlan);
      setPreviewToken(String(result.previewToken));
      setAuthorized(false);
      setConfirmation("");
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
    const form = event.currentTarget;
    setBusy(true);
    try {
      await post("/api/admin/manual-voting/authorize", {
        action,
        previewToken,
        passphrase: String(new FormData(form).get("passphrase")),
      });
      form.reset();
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
      const result = await post("/api/admin/manual-voting/apply", {
        action,
        confirmation,
      });
      setOutcome(
        `${messages.manualVotingOpened} ${messages.audit}: ${String(result.auditId)}`,
      );
      setAuthorized(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="card grid gap-4 p-5"
      aria-labelledby="manual-voting-title"
    >
      <div>
        <p className="eyebrow">{messages.matchPreparation}</p>
        <h2 id="manual-voting-title" className="score-font mt-2 text-xl">
          {messages.manualVotingTitle}
        </h2>
        <p className="text-muted mt-2 text-sm">{messages.manualVotingHelp}</p>
      </div>
      <ul
        className="game-inset grid gap-2 p-4 text-sm"
        aria-label={messages.verificationStatus}
      >
        <Check
          ok={hasVerifiedLineup && detail.match.confirmedStarterCount === 11}
          text={`${messages.confirmedStarters}: ${detail.match.confirmedStarterCount}/11`}
        />
        <Check
          ok={hasVerifiedLineup}
          text={messages.authoritativeLineupRequired}
        />
        <Check ok={hasVerifiedCoach} text={messages.verifiedCoachRequired} />
        <Check ok={!hasConflict} text={messages.canonicalConflictStatus} />
        <Check
          ok={mutable}
          text={`${messages.currentVotingState}: ${messages.ratingStates[detail.match.ratingState]}`}
        />
        <Check
          ok={statusEligibility.allowed}
          text={messages.manualVotingStatusEligible}
        />
        <li>
          {messages.confirmedSubstitutes}:{" "}
          {detail.match.confirmedSubstituteCount}
        </li>
        <li>
          {messages.unconfirmedOrUnused}:{" "}
          {detail.match.unconfirmedOrUnusedCount}
        </li>
        <li>
          {messages.fixture}: {detail.match.externalFixtureId} · {teamId}
        </li>
      </ul>
      {statusEligibility.allowed &&
      ["scheduled", "live"].includes(detail.match.status) ? (
        <p className="text-warning" role="status">
          {messages.manualVotingProviderDelay}
        </p>
      ) : null}
      {!statusEligibility.allowed ? (
        <p className="text-warning" role="status">
          {messages.manualVotingStatusBlocked[statusEligibility.reason]}
        </p>
      ) : null}
      {!ready ? (
        <div className="grid gap-2">
          {statusEligibility.allowed ? (
            <p className="text-warning" role="status">
              {messages.manualVotingMissingEvidence}
            </p>
          ) : null}
          {!hasVerifiedCoach ? (
            <a
              className="button-secondary inline-flex min-h-11 items-center justify-center px-4"
              href="#coach-assignment"
            >
              {messages.coachRecovery}
            </a>
          ) : null}
        </div>
      ) : null}
      {ready && !preview ? (
        <form className="grid gap-4" onSubmit={createPreview}>
          <fieldset className="grid gap-3">
            <legend className="font-bold">{messages.votingDuration}</legend>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                checked={closeMode === "default"}
                onChange={() => {
                  setCloseMode("default");
                  resetAuthorization();
                }}
              />
              {messages.defaultVotingClose}
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                checked={closeMode === "custom"}
                onChange={() => {
                  setCloseMode("custom");
                  resetAuthorization();
                }}
              />
              {messages.customVotingClose}
            </label>
          </fieldset>
          {closeMode === "custom" ? (
            <label className="grid gap-2">
              <span>{messages.costaRicaCloseTime}</span>
              <input
                className="game-inset min-h-11 px-3"
                type="datetime-local"
                value={customClosesAtLocal}
                onChange={(event) => {
                  setCustomClosesAtLocal(event.target.value);
                  resetAuthorization();
                }}
                required
              />
            </label>
          ) : null}
          <label className="grid gap-2">
            <span>{messages.finalWhistleEvidence}</span>
            <input
              className="game-inset min-h-11 px-3"
              type="url"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                resetAuthorization();
              }}
              required
            />
          </label>
          <label className="grid gap-2">
            <span>{messages.reason}</span>
            <textarea
              className="game-inset min-h-24 p-3"
              minLength={10}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                resetAuthorization();
              }}
              required
            />
          </label>
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => {
                setConfirmed(event.target.checked);
                resetAuthorization();
              }}
              required
            />
            {messages.finalWhistleAttestation}
          </label>
          <button
            className="button-secondary min-h-11 px-4"
            disabled={busy || !confirmed}
          >
            {busy ? messages.loading : messages.preview}
          </button>
        </form>
      ) : null}
      {preview ? (
        <div className="grid gap-4">
          <div className="game-inset grid gap-2 p-4 text-sm">
            <strong>{messages.manualVotingPreview}</strong>
            <span>
              {messages.providerStatus}: {preview.providerStatus}
            </span>
            <span>
              {messages.finalWhistleEvidence}: {preview.verificationSource}
            </span>
            <span>
              {messages.proposedOpening}:{" "}
              {formatCostaRica(preview.proposedOpensAt)}
            </span>
            <span>
              {messages.proposedClosing}:{" "}
              {formatCostaRica(preview.proposedClosesAt)}
            </span>
            <span>
              {messages.effectiveDuration}: {preview.durationMinutes} min
            </span>
          </div>
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
              <p className="text-success" role="status">
                {messages.authorizationSuccess}
              </p>
              <label className="grid gap-2">
                <span>{messages.confirmation}</span>
                <input
                  className="game-inset min-h-11 px-3"
                  placeholder={`open-voting:${detail.match.id}`}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <button
                className="button-primary min-h-11 px-4"
                type="button"
                disabled={
                  busy || confirmation !== `open-voting:${detail.match.id}`
                }
                onClick={apply}
              >
                {messages.openVotingNow}
              </button>
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
        <p className="border-success text-success" role="status">
          {outcome}
        </p>
      ) : null}
    </section>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li>
      <strong aria-hidden="true">{ok ? "✓" : "!"}</strong> {text}
    </li>
  );
}

function formatCostaRica(value: string) {
  return new Intl.DateTimeFormat("es-CR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Costa_Rica",
  }).format(new Date(value));
}
