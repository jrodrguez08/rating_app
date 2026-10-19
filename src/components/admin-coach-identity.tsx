"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { Messages } from "@/i18n/messages";
import type {
  AdminCoachIdentityPlan,
  CoachIdentityEvidence,
  CoachIdentityOption,
  CoachIdentitySuggestion,
  CoachIdentitySuggestionResult,
  CoachSearchResult,
} from "@/lib/firebase/admin-coach-identity";
import type { AdminCoachIdentityAction } from "@/lib/server/admin-coach-identity-action";

import { PlayerAvatar } from "./player-avatar";

type AdminMessages = Messages["admin"];

export function AdminCoachIdentityReconciliation({
  messages,
  teamName,
}: {
  messages: AdminMessages;
  teamName: string;
}) {
  const [suggestions, setSuggestions] = useState<
    CoachIdentitySuggestionResult | undefined
  >();
  const [deferred, setDeferred] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [coaches, setCoaches] = useState<CoachIdentityOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [selected, setSelected] = useState<CoachIdentityOption[]>([]);
  const [canonicalCoachId, setCanonicalCoachId] = useState("");
  const [action, setAction] = useState<AdminCoachIdentityAction | null>(null);
  const [plan, setPlan] = useState<AdminCoachIdentityPlan | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");

  const loadSuggestions = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/coach-identities/suggestions", {
        cache: "no-store",
      });
      const value: unknown = await response.json();
      if (!response.ok || !isSuggestionResult(value)) throw new Error();
      setSuggestions(value);
    } catch {
      setError(messages.coachSearchError);
    }
  }, [messages.coachSearchError]);

  const loadCoaches = useCallback(
    async (cursor?: string, signal?: AbortSignal) => {
      setSearching(true);
      try {
        const parameters = new URLSearchParams({ query: search.trim() });
        if (cursor) parameters.set("cursor", cursor);
        const response = await fetch(
          `/api/admin/coach-identities?${parameters}`,
          {
            cache: "no-store",
            signal,
          },
        );
        const value: unknown = await response.json();
        if (!response.ok || !isSearchResult(value)) throw new Error();
        setCoaches((current) =>
          cursor
            ? uniqueCoaches([...current, ...value.coaches])
            : value.coaches,
        );
        setNextCursor(value.nextCursor);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(messages.coachSearchError);
      } finally {
        setSearching(false);
      }
    },
    [messages.coachSearchError, search],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSuggestions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSuggestions]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadCoaches(undefined, controller.signal),
      200,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadCoaches]);

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

  function selectCoach(coach: CoachIdentityOption) {
    setPlan(null);
    setAction(null);
    setOutcome("");
    setSelected((current) => {
      if (current.some(({ id }) => id === coach.id)) return current;
      const next = current.length === 2 ? [coach] : [...current, coach];
      setCanonicalCoachId(next.length === 1 ? next[0].id : "");
      return next;
    });
  }

  async function createPreview(
    pair: CoachIdentityOption[],
    canonicalId: string,
    decision: "match" | "nonmatch",
  ) {
    if (pair.length !== 2 || !canonicalId) return;
    const nextAction: AdminCoachIdentityAction = {
      firstCoachId: pair[0].id,
      secondCoachId: pair[1].id,
      canonicalCoachId: canonicalId,
      decision,
    };
    setBusy(true);
    setOutcome("");
    try {
      const result = await post(
        "/api/admin/coach-identities/preview",
        nextAction,
      );
      setAction(nextAction);
      setPlan(result.plan as AdminCoachIdentityPlan);
      setPreviewToken(String(result.previewToken));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  function chooseSuggestion(
    suggestion: CoachIdentitySuggestion,
    decision: "match" | "nonmatch",
  ) {
    const samePair =
      selected.length === 2 &&
      pairKey(selected[0].id, selected[1].id) ===
        pairKey(suggestion.first.id, suggestion.second.id);
    void createPreview(
      [suggestion.first, suggestion.second],
      samePair && canonicalCoachId
        ? canonicalCoachId
        : suggestion.suggestedCanonicalCoachId,
      decision,
    );
  }

  async function confirmDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !plan?.canApply) return;
    const form = event.currentTarget;
    setBusy(true);
    try {
      await post("/api/admin/coach-identities/authorize", {
        action,
        previewToken,
        passphrase: String(new FormData(form).get("passphrase")),
      });
      const result = await post("/api/admin/coach-identities/apply", {
        action,
        confirmed: true,
      });
      form.reset();
      setOutcome(
        `${messages.coachIdentityApplied} ${messages.audit}: ${String(result.auditId)}`,
      );
      setSelected([]);
      setCanonicalCoachId("");
      setAction(null);
      setPlan(null);
      await loadSuggestions();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  const visibleSuggestions =
    suggestions?.suggestions.filter(
      ({ first, second }) => !deferred.has(pairKey(first.id, second.id)),
    ) ?? [];

  return (
    <div className="grid gap-6">
      <Link className="button-utility w-fit px-4 py-3" href="/admin">
        {messages.backToConsole}
      </Link>
      <header className="card p-5">
        <p className="eyebrow">{messages.identityCoachesTab}</p>
        <h1 className="score-font mt-2 text-2xl">
          {messages.coachIdentityTitle}
        </h1>
        <p className="text-muted mt-2">{messages.coachIdentityHelp}</p>
      </header>

      <section
        className="card grid gap-4 p-5"
        aria-labelledby="coach-suggestions"
      >
        <div>
          <h2 id="coach-suggestions" className="score-font text-xl">
            {messages.possibleDuplicates}
          </h2>
          <p className="text-muted mt-2 text-sm">
            {messages.coachPossibleDuplicatesHelp}
          </p>
        </div>
        {!suggestions ? (
          <p role="status">{messages.loading}</p>
        ) : visibleSuggestions.length === 0 ? (
          <p className="game-inset p-4" role="status">
            {suggestions.providerDataAvailable
              ? messages.noPendingDuplicates
              : messages.waitingForProviderCoaches}
          </p>
        ) : (
          <ul className="grid gap-4">
            {visibleSuggestions.map((suggestion) => {
              const selectedPair =
                selected.length === 2 &&
                pairKey(selected[0].id, selected[1].id) ===
                  pairKey(suggestion.first.id, suggestion.second.id);
              return (
                <li
                  className="game-inset grid gap-4 p-4"
                  key={pairKey(suggestion.first.id, suggestion.second.id)}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <CoachCard
                      coach={suggestion.first}
                      messages={messages}
                      teamName={teamName}
                    />
                    <CoachCard
                      coach={suggestion.second}
                      messages={messages}
                      teamName={teamName}
                    />
                  </div>
                  <fieldset className="grid gap-2">
                    <legend className="font-bold">
                      {messages.chooseCanonicalCoach}
                    </legend>
                    {[suggestion.first, suggestion.second].map((coach) => (
                      <label
                        className="flex min-h-11 items-center gap-3"
                        key={coach.id}
                      >
                        <input
                          type="radio"
                          name={`coach-${pairKey(suggestion.first.id, suggestion.second.id)}`}
                          checked={
                            selectedPair && canonicalCoachId === coach.id
                          }
                          onChange={() => {
                            setSelected([suggestion.first, suggestion.second]);
                            setCanonicalCoachId(coach.id);
                            setAction(null);
                            setPlan(null);
                          }}
                        />
                        {messages.keepCoach}: {coach.name}
                      </label>
                    ))}
                  </fieldset>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="button-primary min-h-11 px-4"
                      type="button"
                      disabled={busy}
                      onClick={() => chooseSuggestion(suggestion, "match")}
                    >
                      {messages.samePerson}
                    </button>
                    <button
                      className="button-secondary min-h-11 px-4"
                      type="button"
                      disabled={busy}
                      onClick={() => chooseSuggestion(suggestion, "nonmatch")}
                    >
                      {messages.coachesDifferent}
                    </button>
                    <button
                      className="button-utility min-h-11 px-4"
                      type="button"
                      onClick={() =>
                        setDeferred(
                          (current) =>
                            new Set([
                              ...current,
                              pairKey(
                                suggestion.first.id,
                                suggestion.second.id,
                              ),
                            ]),
                        )
                      }
                    >
                      {messages.reviewLater}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card grid gap-4 p-5" aria-labelledby="manual-coaches">
        <div>
          <h2 id="manual-coaches" className="score-font text-xl">
            {messages.manualCoachSelection}
          </h2>
          <p className="text-muted mt-2 text-sm">
            {messages.manualCoachSelectionHelp}
          </p>
        </div>
        <label className="grid gap-2">
          <span>{messages.searchCoaches}</span>
          <input
            className="game-inset min-h-11 px-3"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <ul className="game-inset grid max-h-72 gap-2 overflow-auto p-3">
          {coaches.map((coach) => {
            const chosen = selected.some(({ id }) => id === coach.id);
            return (
              <li key={coach.id}>
                <button
                  className="button-utility flex min-h-11 w-full items-center gap-3 px-3 text-left"
                  type="button"
                  aria-pressed={chosen}
                  disabled={chosen}
                  onClick={() => selectCoach(coach)}
                >
                  <PlayerAvatar
                    name={coach.name}
                    photoUrl={coach.photoUrl}
                    size="compact"
                    label={messages.coachAvatar.replace("{coach}", coach.name)}
                  />
                  <span className="min-w-0">
                    <strong className="block truncate">{coach.name}</strong>
                    <span className="text-muted text-sm">
                      {sourceLabel(messages, coach.identityProvenance)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {nextCursor ? (
          <button
            className="button-utility min-h-11 px-4"
            type="button"
            disabled={searching}
            onClick={() => void loadCoaches(nextCursor)}
          >
            {searching ? messages.searchingCoaches : messages.loadMoreCoaches}
          </button>
        ) : null}
        {selected.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {selected.map((coach) => (
              <div className="game-inset grid gap-3 p-4" key={coach.id}>
                <CoachCard
                  coach={coach}
                  messages={messages}
                  teamName={teamName}
                />
                <button
                  className="button-utility min-h-11 px-3"
                  type="button"
                  onClick={() => {
                    const next = selected.filter(({ id }) => id !== coach.id);
                    setSelected(next);
                    setCanonicalCoachId(next[0]?.id ?? "");
                    setAction(null);
                    setPlan(null);
                  }}
                >
                  {messages.removeCoach}
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {selected.length === 2 ? (
          <fieldset className="game-inset grid gap-3 p-4">
            <legend className="px-2 font-bold">
              {messages.chooseCanonicalCoach}
            </legend>
            {selected.map((coach) => (
              <label
                className="flex min-h-11 items-center gap-3"
                key={coach.id}
              >
                <input
                  type="radio"
                  name="canonicalCoach"
                  checked={canonicalCoachId === coach.id}
                  onChange={() => {
                    setCanonicalCoachId(coach.id);
                    setAction(null);
                    setPlan(null);
                  }}
                />
                {messages.keepCoach}: {coach.name}
              </label>
            ))}
            <div className="flex flex-wrap gap-3">
              <button
                className="button-primary min-h-11 px-4"
                type="button"
                disabled={!canonicalCoachId || busy}
                onClick={() =>
                  void createPreview(selected, canonicalCoachId, "match")
                }
              >
                {messages.reviewPair}
              </button>
              <button
                className="button-secondary min-h-11 px-4"
                type="button"
                disabled={!canonicalCoachId || busy}
                onClick={() =>
                  void createPreview(selected, canonicalCoachId, "nonmatch")
                }
              >
                {messages.coachesDifferent}
              </button>
            </div>
          </fieldset>
        ) : null}
      </section>

      {plan && action ? (
        <section className="card grid gap-5 p-5" aria-labelledby="coach-plan">
          <h2 id="coach-plan" className="score-font text-xl">
            {messages.coachIdentityComparison}
          </h2>
          <p className="game-inset p-4" role="status">
            <strong>{statusLabel(messages, plan.status)}</strong>
            <span className="mt-1 block">{plan.explanation}</span>
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <EvidenceCard
              title={`${messages.keepCoach}: ${plan.canonical.name}`}
              value={plan.canonical}
              messages={messages}
              teamName={teamName}
            />
            <EvidenceCard
              title={plan.duplicate.name}
              value={plan.duplicate}
              messages={messages}
              teamName={teamName}
            />
          </div>
          {plan.warnings.map((warning) => (
            <p className="border-warning game-inset p-3 text-sm" key={warning}>
              {warning}
            </p>
          ))}
          {plan.canApply ? (
            <form className="grid gap-3" onSubmit={confirmDecision}>
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
              <button className="button-primary min-h-11 px-4" disabled={busy}>
                {busy
                  ? messages.loading
                  : action.decision === "match"
                    ? messages.consolidateCoaches
                    : messages.confirmDifferentCoaches}
              </button>
            </form>
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

function CoachCard({
  coach,
  messages,
  teamName,
}: {
  coach: CoachIdentityOption;
  messages: AdminMessages;
  teamName: string;
}) {
  return (
    <article className="flex min-w-0 items-center gap-3">
      <PlayerAvatar
        name={coach.name}
        photoUrl={coach.photoUrl}
        size="compact"
        label={messages.coachAvatar.replace("{coach}", coach.name)}
      />
      <div className="min-w-0 text-sm">
        <h3 className="break-words font-bold">{coach.name}</h3>
        <p className="text-muted">
          {sourceLabel(messages, coach.identityProvenance)}
        </p>
        <p className="text-muted">
          {coach.teamCount > 0 ? teamName : messages.noCoachAssociation} ·{" "}
          {messages.coachMatches}: {coach.matchCount}
        </p>
      </div>
    </article>
  );
}

function EvidenceCard({
  title,
  value,
  messages,
  teamName,
}: {
  title: string;
  value: CoachIdentityEvidence;
  messages: AdminMessages;
  teamName: string;
}) {
  return (
    <article className="game-inset grid gap-3 p-4">
      <PlayerAvatar
        name={value.name}
        photoUrl={value.photoUrl}
        size="profile"
        label={messages.coachAvatar.replace("{coach}", value.name)}
      />
      <h3 className="break-words font-bold">{title}</h3>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-muted">{messages.coachTeams}</dt>
          <dd>
            {value.teamCount > 0 ? teamName : messages.noCoachAssociation}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{messages.coachMatches}</dt>
          <dd>{value.matchCount}</dd>
        </div>
        <div>
          <dt className="text-muted">{messages.coachVerifiedAssignments}</dt>
          <dd>{value.verifiedAssignments}</dd>
        </div>
        <div>
          <dt className="text-muted">{messages.reconciliation}</dt>
          <dd>{sourceLabel(messages, value.identityProvenance)}</dd>
        </div>
      </dl>
      <p className={value.hasProtectedHistory ? "text-warning" : "text-muted"}>
        {value.hasProtectedHistory
          ? messages.protectedHistory
          : messages.noProtectedHistory}
      </p>
    </article>
  );
}

function sourceLabel(
  messages: AdminMessages,
  provenance: CoachIdentityOption["identityProvenance"],
) {
  return provenance === "operator_verified"
    ? messages.sourceManual
    : messages.sourceProvider;
}

function statusLabel(
  messages: AdminMessages,
  status: AdminCoachIdentityPlan["status"],
) {
  return {
    safe: messages.safeIdentityLink,
    already_linked: messages.alreadyLinkedCoaches,
    confirmed_different: messages.confirmedDifferentCoaches,
    insufficient_evidence: messages.insufficientIdentityEvidence,
    history_conflict: messages.conflictingCoachHistory,
  }[status];
}

function pairKey(first: string, second: string) {
  return [first, second].sort().join(":");
}

function uniqueCoaches(coaches: CoachIdentityOption[]) {
  return [...new Map(coaches.map((coach) => [coach.id, coach])).values()];
}

function isSuggestionResult(
  value: unknown,
): value is CoachIdentitySuggestionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "providerDataAvailable" in value &&
    typeof value.providerDataAvailable === "boolean" &&
    "suggestions" in value &&
    Array.isArray(value.suggestions)
  );
}

function isSearchResult(value: unknown): value is CoachSearchResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "coaches" in value &&
    Array.isArray(value.coaches)
  );
}
