"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { Messages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";
import type { AdminCoachAction } from "@/lib/server/admin-coach-action";

type AdminMessages = Messages["admin"];

export function AdminMatchCoachPanel({
  detail,
  messages,
  teamId,
}: {
  detail: AdminMatchDetail;
  messages: AdminMessages;
  teamId: string;
}) {
  const router = useRouter();
  const coaches = detail.coaches ?? [];
  const [coachId, setCoachId] = useState("");
  const [coachName, setCoachName] = useState("");
  const [providerCoachId, setProviderCoachId] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const mutable = ["not_ready", "preparing_rating"].includes(
    detail.match.ratingState,
  );
  const action = useMemo<AdminCoachAction>(
    () => ({
      matchId: detail.match.id,
      trackedTeamId: teamId,
      externalFixtureId: detail.match.externalFixtureId,
      coachId,
      coachName,
      ...(providerCoachId ? { externalProviderCoachId: providerCoachId } : {}),
      verificationSource: evidence,
      verificationReason: reason,
    }),
    [
      coachId,
      coachName,
      detail.match,
      evidence,
      providerCoachId,
      reason,
      teamId,
    ],
  );

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

  function reset() {
    setPreview(null);
    setAuthorized(false);
    setOutcome("");
  }

  function chooseCoach(id: string) {
    const coach = coaches.find((item) => item.id === id);
    setCoachId(id);
    setCoachName(coach?.name ?? "");
    setProviderCoachId(coach?.externalProviderId ?? "");
    reset();
  }

  async function createPreview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await post("/api/admin/coach-assignment/preview", action);
      setPreview(result.plan as Record<string, unknown>);
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
      await post("/api/admin/coach-assignment/authorize", {
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
      const result = await post("/api/admin/coach-assignment/apply", {
        action,
        confirmation,
      });
      setOutcome(
        `${messages.applied} ${messages.audit}: ${String(result.auditId)}`,
      );
      setAuthorized(false);
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
    <section id="coach-assignment" className="card grid gap-4 p-5">
      <h2 className="score-font text-xl">{messages.coachRecovery}</h2>
      {detail.match.verification ? (
        <p className="text-success" role="status">
          {messages.verifiedAssignment}: {detail.match.assignment?.coachName}
        </p>
      ) : null}
      {!mutable ? (
        <p className="text-warning">{messages.coachAssignmentLocked}</p>
      ) : null}
      {mutable && !preview ? (
        <form className="grid gap-4" onSubmit={createPreview}>
          <p className="game-inset p-3 text-sm">
            {messages.fixture}: {detail.match.externalFixtureId} · {teamId}
          </p>
          <label className="grid gap-2">
            <span>{messages.existingCoach}</span>
            <select
              className="game-inset min-h-11 px-3"
              value={coachId}
              onChange={(event) => chooseCoach(event.target.value)}
            >
              <option value="">{messages.newCoach}</option>
              {coaches.map((coach) => (
                <option key={coach.id} value={coach.id}>
                  {coach.name} · {coach.id}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <span>{messages.manualCoachId}</span>
            <input
              className="game-inset min-h-11 px-3"
              value={coachId}
              onChange={(event) => {
                setCoachId(event.target.value);
                reset();
              }}
              required
            />
          </label>
          <label className="grid gap-2">
            <span>{messages.coachName}</span>
            <input
              className="game-inset min-h-11 px-3"
              value={coachName}
              onChange={(event) => {
                setCoachName(event.target.value);
                reset();
              }}
              required
            />
          </label>
          <label className="grid gap-2">
            <span>{messages.providerCoachId}</span>
            <input
              className="game-inset min-h-11 px-3"
              inputMode="numeric"
              value={providerCoachId}
              onChange={(event) => {
                setProviderCoachId(event.target.value);
                reset();
              }}
            />
          </label>
          <label className="grid gap-2">
            <span>{messages.evidence}</span>
            <input
              className="game-inset min-h-11 px-3"
              type="url"
              value={evidence}
              onChange={(event) => {
                setEvidence(event.target.value);
                reset();
              }}
              required
            />
          </label>
          <label className="grid gap-2">
            <span>{messages.reason}</span>
            <textarea
              className="game-inset min-h-28 p-3"
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                reset();
              }}
              required
            />
          </label>
          <button className="button-secondary min-h-11 px-4" disabled={busy}>
            {messages.preview}
          </button>
        </form>
      ) : null}
      {preview ? (
        <div className="grid gap-4">
          <pre className="game-inset overflow-auto whitespace-pre-wrap p-4 text-sm">
            {JSON.stringify(preview, null, 2)}
          </pre>
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
                  placeholder={`assign-verified-coach:${detail.match.id}`}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <button
                className="button-primary min-h-11 px-4"
                type="button"
                disabled={
                  busy ||
                  confirmation !== `assign-verified-coach:${detail.match.id}`
                }
                onClick={apply}
              >
                {messages.apply}
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
