"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import type { Messages } from "@/i18n/messages";
import type { AdminPlayerOption } from "@/lib/firebase/admin-console";
import type { AdminPlayerIdentityPlan } from "@/lib/firebase/admin-player-identity";
import type { AdminPlayerIdentityAction } from "@/lib/server/admin-player-identity-action";

import { isPlayerSearchResponse } from "./admin-lineup-draft";

type AdminMessages = Messages["admin"];

export function AdminPlayerIdentityReconciliation({
  messages,
  teamId,
}: {
  messages: AdminMessages;
  teamId: string;
}) {
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<AdminPlayerOption[]>([]);
  const [canonicalPlayerId, setCanonicalPlayerId] = useState("");
  const [externalPlayerId, setExternalPlayerId] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<AdminPlayerIdentityAction | null>(null);
  const [plan, setPlan] = useState<AdminPlayerIdentityPlan | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/admin/players?query=${encodeURIComponent(search.trim())}`,
          { cache: "no-store", signal: controller.signal },
        );
        const value: unknown = await response.json();
        if (!response.ok || !isPlayerSearchResponse(value)) throw new Error();
        setPlayers(
          value.players.filter(
            ({ identityProvenance }) =>
              identityProvenance === "operator_verified",
          ),
        );
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(messages.playerSearchError);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [messages.playerSearchError, search]);

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
    if (!response.ok || typeof result !== "object" || result === null) {
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

  async function preview(decision: "match" | "nonmatch") {
    const nextAction: AdminPlayerIdentityAction = {
      canonicalPlayerId,
      trackedTeamId: teamId,
      externalProvider: "api-football",
      externalProviderPlayerId: externalPlayerId.trim(),
      decision,
      verificationSource: evidence.trim(),
      verificationReason: reason.trim(),
    };
    setBusy(true);
    setOutcome("");
    try {
      const result = await post(
        "/api/admin/player-identities/preview",
        nextAction,
      );
      setAction(nextAction);
      setPlan(result.plan as AdminPlayerIdentityPlan);
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
    if (!action) return;
    const form = event.currentTarget;
    setBusy(true);
    try {
      const passphrase = String(new FormData(form).get("passphrase"));
      await post("/api/admin/player-identities/authorize", {
        action,
        previewToken,
        passphrase,
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
    if (!action) return;
    setBusy(true);
    try {
      const result = await post("/api/admin/player-identities/apply", {
        action,
        confirmation,
      });
      setOutcome(
        `${messages.identityReconciliationApplied} ${messages.audit}: ${String(result.auditId)}`,
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

  function cancel() {
    setAction(null);
    setPlan(null);
    setPreviewToken("");
    setAuthorized(false);
    setConfirmation("");
    setError("");
  }

  const selected = players.find(({ id }) => id === canonicalPlayerId);
  const ready =
    canonicalPlayerId !== "" &&
    /^[1-9][0-9]*$/.test(externalPlayerId.trim()) &&
    evidence.startsWith("https://") &&
    reason.trim().length >= 10;

  return (
    <div className="grid gap-6">
      <Link className="button-utility w-fit px-4 py-3" href="/admin">
        {messages.backToConsole}
      </Link>
      <section className="card grid gap-4 p-5">
        <div>
          <p className="eyebrow">{messages.identityReconciliation}</p>
          <h2 className="score-font mt-2 text-xl">
            {messages.identityReconciliationTitle}
          </h2>
          <p className="text-muted mt-2 text-sm">
            {messages.identityReconciliationHelp}
          </p>
        </div>
        <label className="grid gap-2">
          <span>{messages.searchManualPlayer}</span>
          <input
            className="game-inset min-h-11 px-3"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <ul className="game-inset grid max-h-64 gap-2 overflow-auto p-3">
          {players.map((player) => (
            <li key={player.id}>
              <button
                className="button-utility min-h-11 w-full px-3 text-left"
                type="button"
                aria-pressed={canonicalPlayerId === player.id}
                onClick={() => {
                  setCanonicalPlayerId(player.id);
                  cancel();
                  setCanonicalPlayerId(player.id);
                }}
              >
                {player.name} · {player.id}
              </button>
            </li>
          ))}
        </ul>
        {selected ? (
          <p className="text-success text-sm" role="status">
            {messages.selectedCanonicalPlayer.replace(
              "{player}",
              selected.name,
            )}
          </p>
        ) : null}
        <label className="grid gap-2">
          <span>{messages.apiFootballPlayerId}</span>
          <input
            className="game-inset min-h-11 px-3"
            inputMode="numeric"
            value={externalPlayerId}
            onChange={(event) => {
              setExternalPlayerId(event.target.value);
              cancel();
            }}
          />
        </label>
        <label className="grid gap-2">
          <span>{messages.evidence}</span>
          <input
            className="game-inset min-h-11 px-3"
            type="url"
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
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
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            className="min-h-11 bg-brand px-4 font-bold"
            type="button"
            disabled={!ready || busy}
            onClick={() => void preview("match")}
          >
            {messages.samePerson}
          </button>
          <button
            className="button-secondary min-h-11 px-4"
            type="button"
            disabled={!ready || busy}
            onClick={() => void preview("nonmatch")}
          >
            {messages.notSamePerson}
          </button>
          <button
            className="button-utility min-h-11 px-4"
            type="button"
            onClick={cancel}
          >
            {messages.cancel}
          </button>
        </div>
      </section>

      {plan && action ? (
        <section
          className="card grid gap-5 p-5"
          aria-labelledby="identity-plan"
        >
          <h2 id="identity-plan" className="score-font text-xl">
            {messages.identityComparison}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <IdentityCard
              title={messages.manualIdentity}
              value={plan.canonical}
            />
            <IdentityCard
              title={messages.providerIdentity}
              value={plan.provider}
            />
          </div>
          {plan.warnings.map((warning) => (
            <p className="border-warning game-inset p-3 text-sm" key={warning}>
              {warning}
            </p>
          ))}
          <div>
            <strong>{messages.exactChanges}</strong>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {plan.proposedChanges.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
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
            <button
              className="min-h-11 bg-accent px-4 font-bold text-black"
              disabled={busy}
            >
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
                  placeholder={`reconcile-player:${action.canonicalPlayerId}`}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <button
                className="min-h-11 bg-brand px-4 font-bold"
                type="button"
                disabled={
                  busy ||
                  confirmation !==
                    `reconcile-player:${action.canonicalPlayerId}`
                }
                onClick={() => void apply()}
              >
                {messages.applyIdentityDecision}
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

function IdentityCard({
  title,
  value,
}: {
  title: string;
  value: AdminPlayerIdentityPlan["canonical"];
}) {
  return (
    <article className="game-inset min-w-0 p-4">
      <h3 className="font-bold">{title}</h3>
      <dl className="mt-3 grid gap-2 text-sm">
        {Object.entries(value).map(([key, item]) => (
          <div className="grid gap-1" key={key}>
            <dt className="text-muted">{key}</dt>
            <dd className="break-words">
              {Array.isArray(item)
                ? item.join(", ") || "—"
                : String(item ?? "—")}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
