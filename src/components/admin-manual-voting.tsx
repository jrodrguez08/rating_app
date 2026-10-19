"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { formatDate } from "@/i18n/format";
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
  const hasVerifiedLineup =
    detail.match.lineupProvenance === "operator_verified";
  const hasVerifiedCoach = detail.match.verification !== undefined;
  const hasConflict = detail.reconciliation?.status === "conflict";
  const availability = detail.manualVotingAvailability;
  const ready = availability.state === "available";
  const availabilityMessages = messages.manualVotingStates[availability.state];
  const availabilityDescription =
    availability.state === "ineligible_status"
      ? blockedStatusDescription(detail.match.status, messages)
      : availabilityMessages.description;
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
          {availabilityMessages.title}
        </h2>
        <p className="text-muted mt-2 text-sm">
          {ready
            ? messages.manualVotingHelp
            : ["voting_open", "voting_expired", "results_published"].includes(
                  availability.state,
                )
              ? availabilityDescription
              : messages.verificationStatus}
        </p>
      </div>
      {availability.state === "voting_open" ||
      availability.state === "voting_expired" ||
      availability.state === "results_published" ? (
        <VotingSummary detail={detail} messages={messages} />
      ) : (
        <ul className="game-inset grid gap-2 p-4 text-sm">
          <Check
            ok={availability.state !== "ineligible_status"}
            text={`${messages.providerStatus}: ${messages.statuses[detail.match.status]}`}
          />
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
      )}
      {ready ? (
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
      ) : null}
      {!ready &&
      !["voting_open", "voting_expired", "results_published"].includes(
        availability.state,
      ) ? (
        <p className="text-warning" role="status">
          {availabilityDescription}
        </p>
      ) : null}
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

function blockedStatusDescription(
  status: AdminMatchDetail["match"]["status"],
  messages: AdminMessages,
): string {
  switch (status) {
    case "postponed":
    case "suspended":
    case "cancelled":
    case "abandoned":
      return messages.manualVotingStatusBlocked[status];
    default:
      return messages.manualVotingStates.ineligible_status.description;
  }
}

function VotingSummary({
  detail,
  messages,
}: {
  detail: AdminMatchDetail;
  messages: AdminMessages;
}) {
  const match = detail.match;
  const coachName =
    match.assignment?.coachName ??
    detail.coaches?.find((coach) => coach.id === match.verification?.coachId)
      ?.name ??
    messages.notMeasured;
  return (
    <div className="game-inset grid gap-2 p-4 text-sm">
      <strong>
        {match.homeTeamName} {messages.versus} {match.awayTeamName}
      </strong>
      <span>
        {messages.confirmedStarters}: {match.confirmedStarterCount}/11
      </span>
      <span>
        {messages.confirmedSubstitutes}: {match.confirmedSubstituteCount}
      </span>
      <span>
        {messages.coach}: {coachName}
      </span>
      {match.effectiveVotingOpensAt ? (
        <span>
          {messages.votingOpenedAt}:{" "}
          {formatCostaRica(match.effectiveVotingOpensAt)}
        </span>
      ) : null}
      {match.effectiveVotingClosesAt ? (
        <span>
          {messages.votingClosesAt}:{" "}
          {formatCostaRica(match.effectiveVotingClosesAt)}
        </span>
      ) : null}
      {match.votingPresentation === "open" &&
      match.votingRemainingMinutes !== undefined ? (
        <span>
          {messages.timeRemaining}:{" "}
          {messages.minutes.replace(
            "{count}",
            String(match.votingRemainingMinutes),
          )}
        </span>
      ) : null}
      {match.votingPresentation === "published" ? (
        <Link
          className="button-secondary mt-2 inline-flex min-h-11 items-center justify-center px-4"
          href={`/matches/${encodeURIComponent(match.id)}/results`}
        >
          {messages.viewResults}
        </Link>
      ) : null}
    </div>
  );
}

function formatCostaRica(value: string): string {
  return `${formatDate(value, "es", {
    dateStyle: "medium",
    timeStyle: "short",
  })} (Costa Rica)`;
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li>
      <strong aria-hidden="true">{ok ? "✓" : "!"}</strong> {text}
    </li>
  );
}
