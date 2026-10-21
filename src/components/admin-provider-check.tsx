"use client";

import { useState } from "react";

import { formatDate } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import type {
  AdminProviderCheckPerson,
  AdminProviderCheckReport,
  AdminProviderCheckSide,
} from "@/lib/firebase/admin-provider-check";
import type { AdminMatchOperation } from "@/lib/firebase/admin-console";

type AdminMessages = Messages["admin"];

export function AdminProviderCheck({
  match,
  messages,
  teamId,
}: {
  match: AdminMatchOperation;
  messages: AdminMessages;
  teamId: string;
}) {
  const [report, setReport] = useState<AdminProviderCheckReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eligible = match.ratingState === "rating_closed";

  async function checkProvider() {
    setBusy(true);
    setError("");
    try {
      const csrf = document.cookie
        .split("; ")
        .find((item) => item.startsWith("rating_admin_csrf="))
        ?.split("=")[1];
      const response = await fetch("/api/admin/provider-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-CSRF": csrf ?? "",
        },
        body: JSON.stringify({
          matchId: match.id,
          trackedTeamId: teamId,
          externalFixtureId: match.externalFixtureId,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        throw new Error(responseError(result, messages.genericError));
      }
      if (!hasReport(result)) throw new Error(messages.genericError);
      setReport(result.report);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  const labels = messages.providerCheck;
  return (
    <section
      className="card grid gap-4 p-5"
      aria-labelledby="provider-check-title"
    >
      <div>
        <p className="eyebrow">{labels.eyebrow}</p>
        <h2 id="provider-check-title" className="score-font mt-2 text-xl">
          {labels.title}
        </h2>
        <p className="text-muted mt-2 text-sm">{labels.description}</p>
      </div>
      <button
        className="button-secondary min-h-11 px-4"
        type="button"
        disabled={busy || !eligible}
        onClick={checkProvider}
      >
        {busy ? labels.checking : labels.action}
      </button>
      {!eligible ? (
        <p className="text-muted text-sm" role="status">
          {labels.unavailable}
        </p>
      ) : null}
      {error ? (
        <p className="border-danger text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {report ? (
        <div className="grid gap-4" aria-live="polite">
          <p className={statusClass(report.status)} role="status">
            {labels.statuses[report.status]}
          </p>
          <dl className="game-inset grid gap-2 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">{labels.checkedAt}</dt>
              <dd className="font-bold">
                {formatDate(report.checkedAt, "es", {
                  dateStyle: "short",
                  timeStyle: "medium",
                })}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{labels.requestCount}</dt>
              <dd className="font-bold">{report.providerRequests}</dd>
            </div>
            {report.providerFixtureStatus ? (
              <div>
                <dt className="text-muted">{labels.providerFixtureStatus}</dt>
                <dd className="font-bold">
                  {messages.statuses[report.providerFixtureStatus]}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            <EvidenceSide
              title={labels.localEvidence}
              subtitle={labels.source[report.localEvidenceSource]}
              side={report.local}
              messages={messages}
            />
            <EvidenceSide
              title={labels.providerEvidence}
              side={report.provider}
              messages={messages}
            />
          </div>
          {report.missingEvidence.length > 0 ? (
            <section className="game-inset grid gap-2 p-4">
              <h3 className="score-font text-base">{labels.missingTitle}</h3>
              <ul className="list-disc pl-5 text-sm">
                {report.missingEvidence.map((item) => (
                  <li key={item}>{labels.missing[item]}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {report.differences.length > 0 ? (
            <section className="game-inset grid gap-2 p-4">
              <h3 className="score-font text-base">
                {labels.differencesTitle}
              </h3>
              <ul className="list-disc pl-5 text-sm">
                {report.differences.map((difference, index) => (
                  <li key={`${difference.type}-${difference.name}-${index}`}>
                    <strong>{difference.name}:</strong>{" "}
                    {labels.differences[difference.type]}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function EvidenceSide({
  title,
  subtitle,
  side,
  messages,
}: {
  title: string;
  subtitle?: string;
  side: AdminProviderCheckSide;
  messages: AdminMessages;
}) {
  const labels = messages.providerCheck;
  return (
    <section className="game-inset grid content-start gap-3 p-4">
      <div>
        <h3 className="score-font text-lg">{title}</h3>
        {subtitle ? <p className="text-muted text-xs">{subtitle}</p> : null}
      </div>
      <People
        title={labels.starters}
        people={side.starters}
        messages={messages}
      />
      <People
        title={labels.participatingSubstitutes}
        people={side.participatingSubstitutes}
        messages={messages}
      />
      <div>
        <h4 className="text-sm font-bold">{labels.coach}</h4>
        <p className="text-sm">{side.coachName ?? labels.noCoach}</p>
      </div>
    </section>
  );
}

function People({
  title,
  people,
  messages,
}: {
  title: string;
  people: AdminProviderCheckPerson[];
  messages: AdminMessages;
}) {
  return (
    <div>
      <h4 className="text-sm font-bold">{title}</h4>
      {people.length === 0 ? (
        <p className="text-muted text-sm">{messages.providerCheck.noPlayers}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {people.map((person, index) => (
            <li key={`${person.name}-${index}`}>
              {person.name}
              {person.enteredAtMinute === undefined
                ? ""
                : ` · ${messages.providerCheck.enteredMinute.replace(
                    "{minute}",
                    String(person.enteredAtMinute),
                  )}`}
              {person.exitedAtMinute === undefined
                ? ""
                : ` · ${messages.providerCheck.exitedMinute.replace(
                    "{minute}",
                    String(person.exitedAtMinute),
                  )}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusClass(status: AdminProviderCheckReport["status"]): string {
  if (status === "available") return "border-success text-success";
  if (status === "differences" || status === "provider_error") {
    return "border-danger text-danger";
  }
  return "text-warning";
}

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback;
}

function hasReport(
  value: unknown,
): value is { report: AdminProviderCheckReport } {
  return (
    typeof value === "object" &&
    value !== null &&
    "report" in value &&
    typeof value.report === "object" &&
    value.report !== null &&
    "status" in value.report &&
    typeof value.report.status === "string" &&
    "checkedAt" in value.report &&
    typeof value.report.checkedAt === "string" &&
    "providerRequests" in value.report &&
    typeof value.report.providerRequests === "number" &&
    "local" in value.report &&
    "provider" in value.report &&
    "differences" in value.report &&
    Array.isArray(value.report.differences) &&
    "missingEvidence" in value.report &&
    Array.isArray(value.report.missingEvidence)
  );
}
