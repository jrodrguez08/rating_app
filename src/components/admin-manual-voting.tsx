"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { manualVotingStatusEligibility } from "@/domain/manual-voting";
import type { Messages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";
import type { AdminManualVotingAction } from "@/lib/server/admin-manual-voting-action";

type AdminMessages = Messages["admin"];

export function AdminManualVotingPanel({
  detail,
  messages,
  teamId,
}: {
  detail: AdminMatchDetail;
  messages: AdminMessages;
  teamId: string;
}) {
  const router = useRouter();
  const [closeMode, setCloseMode] = useState<"default" | "custom">("default");
  const [customClosesAtLocal, setCustomClosesAtLocal] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const mutable = ["not_ready", "preparing_rating"].includes(
    detail.match.ratingState,
  );
  const hasVerifiedLineup =
    detail.match.lineupProvenance === "operator_verified";
  const hasVerifiedCoach = detail.match.verification !== undefined;
  const hasConflict = detail.reconciliation?.status === "conflict";
  const statusEligibility = manualVotingStatusEligibility(detail.match.status);
  const ready =
    mutable &&
    statusEligibility.allowed &&
    hasVerifiedLineup &&
    detail.match.confirmedStarterCount === 11 &&
    hasVerifiedCoach &&
    !hasConflict;
  const action: AdminManualVotingAction = {
    matchId: detail.match.id,
    trackedTeamId: teamId,
    externalFixtureId: detail.match.externalFixtureId,
    finalWhistleConfirmed: true,
    verificationSource: "authenticated-owner",
    verificationReason:
      "Pitazo final confirmado por el propietario autenticado.",
    closeMode,
    ...(closeMode === "custom" ? { customClosesAtLocal } : {}),
  };

  async function post(path: string, body: unknown) {
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

  async function openVoting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setOutcome("");
    const form = event.currentTarget;
    try {
      const preview = await post("/api/admin/manual-voting/preview", action);
      await post("/api/admin/manual-voting/authorize", {
        action,
        previewToken: preview.previewToken,
        passphrase: String(new FormData(form).get("passphrase")),
      });
      await post("/api/admin/manual-voting/apply", {
        action,
        confirmation: `open-voting:${detail.match.id}`,
      });
      form.reset();
      setOutcome(messages.manualVotingOpened);
      router.refresh();
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
      aria-labelledby="open-voting-title"
    >
      <div>
        <p className="eyebrow">4 / 4</p>
        <h2 id="open-voting-title" className="score-font mt-2 text-xl">
          {messages.manualVotingTitle}
        </h2>
        <p className="text-muted mt-2 text-sm">{messages.manualVotingHelp}</p>
      </div>
      <ul className="game-inset grid gap-2 p-4 text-sm">
        <Check
          ok={hasVerifiedLineup && detail.match.confirmedStarterCount === 11}
          text={`${messages.confirmedStarters}: ${detail.match.confirmedStarterCount}/11`}
        />
        <Check
          ok={hasVerifiedLineup}
          text={`${messages.confirmedSubstitutes}: ${detail.match.confirmedSubstituteCount}`}
        />
        <Check ok={hasVerifiedCoach} text={messages.verifiedCoachRequired} />
        <Check ok={!hasConflict} text={messages.canonicalConflictStatus} />
      </ul>
      {!ready ? (
        <p className="text-warning" role="status">
          {statusEligibility.allowed
            ? messages.manualVotingMissingEvidence
            : messages.manualVotingStatusBlocked[statusEligibility.reason]}
        </p>
      ) : (
        <form className="grid gap-4" onSubmit={openVoting}>
          <fieldset className="grid gap-3">
            <legend className="font-bold">{messages.votingDuration}</legend>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="closeMode"
                checked={closeMode === "default"}
                onChange={() => setCloseMode("default")}
              />
              {messages.defaultVotingClose}
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="closeMode"
                checked={closeMode === "custom"}
                onChange={() => setCloseMode("custom")}
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
                onChange={(event) => setCustomClosesAtLocal(event.target.value)}
                required
              />
            </label>
          ) : null}
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              required
            />
            {messages.finalWhistleAttestation}
          </label>
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
          <button
            className="button-primary min-h-11 px-4"
            disabled={busy || !confirmed}
          >
            {busy ? messages.loading : messages.openVotingNow}
          </button>
        </form>
      )}
      {error ? (
        <p className="text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {outcome ? (
        <p className="text-success" role="status">
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
