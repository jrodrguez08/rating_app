"use client";

import { useMemo, useState, type FormEvent } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";

import type { Messages } from "@/i18n/messages";
import { formatDate } from "@/i18n/format";
import { getAdminBrowserAuth } from "@/lib/firebase/admin-browser";
import type { AdminOverview } from "@/lib/firebase/admin-console";
import type { AdminCoachAction } from "@/lib/server/admin-coach-action";

type AdminMessages = Messages["admin"];

export function AdminLogin({ messages }: { messages: AdminMessages }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const auth = await getAdminBrowserAuth();
      const credential = await signInWithEmailAndPassword(
        auth,
        String(form.get("email")),
        String(form.get("password")),
      );
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: await credential.user.getIdToken(true),
        }),
      });
      await signOut(auth);
      if (!response.ok) throw new Error();
      window.location.reload();
    } catch {
      setError(messages.credentialsError);
      setBusy(false);
    }
  }
  return (
    <form className="card mx-auto grid max-w-md gap-4 p-6" onSubmit={submit}>
      <label className="grid gap-2">
        <span>{messages.email}</span>
        <input
          className="game-inset min-h-11 px-3"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </label>
      <label className="grid gap-2">
        <span>{messages.password}</span>
        <input
          className="game-inset min-h-11 px-3"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <button
        className="min-h-11 bg-brand px-4 font-bold"
        disabled={busy}
        type="submit"
      >
        {messages.signIn}
      </button>
    </form>
  );
}

export function AdminConsole({
  overview,
  messages,
  teamId,
}: {
  overview: AdminOverview;
  messages: AdminMessages;
  teamId: string;
}) {
  const [matchId, setMatchId] = useState(overview.matches[0]?.id ?? "");
  const [coachId, setCoachId] = useState("");
  const [coachName, setCoachName] = useState("");
  const [providerCoachId, setProviderCoachId] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const selectedMatch = overview.matches.find((match) => match.id === matchId);
  const action = useMemo<AdminCoachAction | null>(() => {
    if (!selectedMatch) return null;
    return {
      matchId: selectedMatch.id,
      trackedTeamId: teamId,
      externalFixtureId: selectedMatch.externalFixtureId,
      coachId,
      coachName,
      ...(providerCoachId ? { externalProviderCoachId: providerCoachId } : {}),
      verificationSource: evidence,
      verificationReason: reason,
    };
  }, [
    coachId,
    coachName,
    evidence,
    providerCoachId,
    reason,
    selectedMatch,
    teamId,
  ]);

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
      const message =
        typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : messages.genericError;
      throw new Error(message);
    }
    return result as Record<string, unknown>;
  }

  function chooseCoach(id: string) {
    const coach = overview.coaches.find((item) => item.id === id);
    setCoachId(id);
    if (coach) {
      setCoachName(coach.name);
      setProviderCoachId(coach.externalProviderId ?? "");
    }
    setPreview(null);
    setAuthorized(false);
  }

  async function createPreview(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
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
    }
  }

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    try {
      const passphrase = String(
        new FormData(event.currentTarget).get("passphrase"),
      );
      await post("/api/admin/coach-assignment/authorize", {
        action,
        previewToken,
        passphrase,
      });
      event.currentTarget.reset();
      setAuthorized(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    }
  }

  async function apply() {
    if (!action) return;
    try {
      const result = await post("/api/admin/coach-assignment/apply", {
        action,
        confirmation,
      });
      setOutcome(
        `${messages.applied} ${messages.audit}: ${String(result.auditId)}`,
      );
      setAuthorized(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    }
  }

  async function logout() {
    try {
      await post("/api/admin/session/logout", {});
    } finally {
      window.location.reload();
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap justify-end gap-3">
        <button
          className="game-inset min-h-11 px-4"
          onClick={() => window.location.reload()}
        >
          {messages.refresh}
        </button>
        <button className="game-inset min-h-11 px-4" onClick={logout}>
          {messages.signOut}
        </button>
      </div>
      {overview.matches.length === 0 ? (
        <p className="card p-6">{messages.noMatches}</p>
      ) : (
        <form className="card grid gap-5 p-5" onSubmit={createPreview}>
          <h2 className="score-font text-xl">{messages.blockedMatches}</h2>
          <label className="grid gap-2">
            <span>{messages.match}</span>
            <select
              className="game-inset min-h-11 px-3"
              value={matchId}
              onChange={(event) => {
                setMatchId(event.target.value);
                setPreview(null);
              }}
            >
              {overview.matches.map((match) => (
                <option key={match.id} value={match.id}>
                  {match.homeTeamName} {messages.versus} {match.awayTeamName} ·{" "}
                  {match.id}
                </option>
              ))}
            </select>
          </label>
          {selectedMatch ? (
            <div className="game-inset grid gap-1 p-4 text-sm">
              <span>
                {messages.lifecycle}: {messages.preparingState}
              </span>
              <span>
                {messages.kickoff}:{" "}
                {formatDate(selectedMatch.kickoffAt, "es", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              <span>
                {messages.fixture}: {selectedMatch.externalFixtureId}
              </span>
              <span>
                {messages.diagnostic}:{" "}
                {messages.diagnostics[selectedMatch.diagnostic ?? "unknown"]}
              </span>
              <span>
                {messages.participants}: {selectedMatch.participantCount}
              </span>
              <span>
                {messages.rateable}: {selectedMatch.rateableParticipantCount}
              </span>
              <span>
                {messages.currentAssignment}:{" "}
                {selectedMatch.assignment
                  ? `${selectedMatch.assignment.coachName} · ${selectedMatch.assignment.coachId}`
                  : messages.none}
              </span>
              <span>
                {messages.verifiedAssignment}:{" "}
                {selectedMatch.verification
                  ? `${selectedMatch.verification.coachId} · ${selectedMatch.verification.verificationSource}`
                  : messages.none}
              </span>
            </div>
          ) : null}
          <label className="grid gap-2">
            <span>{messages.existingCoach}</span>
            <select
              className="game-inset min-h-11 px-3"
              value={coachId}
              onChange={(event) => chooseCoach(event.target.value)}
            >
              <option value="">{messages.newCoach}</option>
              {overview.coaches.map((coach) => (
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
              onChange={(event) => setCoachId(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-2">
            <span>{messages.coachName}</span>
            <input
              className="game-inset min-h-11 px-3"
              value={coachName}
              onChange={(event) => setCoachName(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-2">
            <span>{messages.providerCoachId}</span>
            <input
              className="game-inset min-h-11 px-3"
              inputMode="numeric"
              value={providerCoachId}
              onChange={(event) => setProviderCoachId(event.target.value)}
            />
          </label>
          <label className="grid gap-2">
            <span>{messages.evidence}</span>
            <input
              className="game-inset min-h-11 px-3"
              type="url"
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
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
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </label>
          <button
            className="min-h-11 bg-accent px-4 font-bold text-black"
            type="submit"
          >
            {messages.preview}
          </button>
        </form>
      )}
      {preview && action ? (
        <section
          className="card grid gap-4 p-5"
          aria-labelledby="admin-preview-title"
        >
          <h2 id="admin-preview-title" className="score-font text-xl">
            {messages.previewTitle}
          </h2>
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
            <button
              className="min-h-11 bg-accent px-4 font-bold text-black"
              type="submit"
            >
              {messages.authorize}
            </button>
          </form>
          {authorized ? (
            <div className="grid gap-3">
              <label className="grid gap-2">
                <span>{messages.confirmation}</span>
                <input
                  className="game-inset min-h-11 px-3"
                  placeholder={`assign-verified-coach:${action.matchId}`}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <button
                className="min-h-11 bg-brand px-4 font-bold"
                onClick={apply}
              >
                {messages.apply}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {error ? (
        <p className="card border-danger p-4 text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {outcome ? (
        <p className="card border-success p-4 text-success" role="status">
          {outcome}
        </p>
      ) : null}
    </div>
  );
}
