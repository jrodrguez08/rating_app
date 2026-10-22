"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

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
type SelectionOrigin = "suggestion" | "manual";

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
  const [manualOpen, setManualOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [coaches, setCoaches] = useState<CoachIdentityOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [selected, setSelected] = useState<CoachIdentityOption[]>([]);
  const [origin, setOrigin] = useState<SelectionOrigin>("suggestion");
  const [reviewing, setReviewing] = useState(false);
  const [canonicalId, setCanonicalId] = useState("");
  const [recommendedId, setRecommendedId] = useState("");
  const [evidence, setEvidence] = useState<
    Record<string, CoachIdentityEvidence>
  >({});
  const [action, setAction] = useState<AdminCoachIdentityAction | null>(null);
  const [plan, setPlan] = useState<AdminCoachIdentityPlan | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

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
          { cache: "no-store", signal },
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
    if (!manualOpen || reviewing) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadCoaches(undefined, controller.signal),
      200,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadCoaches, manualOpen, reviewing]);

  useEffect(() => {
    if (reviewing) reviewHeading.current?.focus();
  }, [reviewing]);

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

  function buildAction(
    pair: CoachIdentityOption[],
    keeperId: string,
    decision: "match" | "nonmatch",
  ): AdminCoachIdentityAction {
    return {
      firstCoachId: pair[0].id,
      secondCoachId: pair[1].id,
      canonicalCoachId: keeperId,
      decision,
    };
  }

  function rememberEvidence(nextPlan: AdminCoachIdentityPlan) {
    setEvidence({
      [nextPlan.canonical.id]: nextPlan.canonical,
      [nextPlan.duplicate.id]: nextPlan.duplicate,
    });
  }

  async function beginReview(
    pair: CoachIdentityOption[],
    preferredId: string,
    selectionOrigin: SelectionOrigin,
  ) {
    setSelected(pair);
    setOrigin(selectionOrigin);
    setCanonicalId(preferredId);
    setRecommendedId(preferredId);
    setEvidence({});
    setPlan(null);
    setAction(null);
    setOutcome("");
    setReviewing(true);
    setBusy(true);
    try {
      const result = await post(
        "/api/admin/coach-identities/preview",
        buildAction(pair, preferredId, "match"),
      );
      const nextPlan = result.plan as AdminCoachIdentityPlan;
      rememberEvidence(nextPlan);
      const protectedIdentity = [nextPlan.canonical, nextPlan.duplicate].find(
        ({ hasProtectedHistory }) => hasProtectedHistory,
      );
      if (protectedIdentity) {
        setCanonicalId(protectedIdentity.id);
        setRecommendedId(protectedIdentity.id);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  function chooseSuggestion(suggestion: CoachIdentitySuggestion) {
    void beginReview(
      [suggestion.first, suggestion.second],
      suggestion.suggestedCanonicalCoachId,
      "suggestion",
    );
  }

  function chooseCoach(coach: CoachIdentityOption) {
    if (selected.some(({ id }) => id === coach.id)) return;
    const next = [...selected, coach].slice(-2);
    setSelected(next);
    setPlan(null);
    setAction(null);
    setOutcome("");
    if (next.length === 1) {
      setCanonicalId(next[0].id);
      return;
    }
    const preferredId =
      next.find(
        ({ identityProvenance }) => identityProvenance === "operator_verified",
      )?.id ?? next[0].id;
    void beginReview(next, preferredId, "manual");
  }

  async function createPreview(decision: "match" | "nonmatch") {
    if (selected.length !== 2 || !canonicalId) return;
    const nextAction = buildAction(selected, canonicalId, decision);
    setBusy(true);
    setOutcome("");
    try {
      const result = await post(
        "/api/admin/coach-identities/preview",
        nextAction,
      );
      const nextPlan = result.plan as AdminCoachIdentityPlan;
      rememberEvidence(nextPlan);
      setAction(nextAction);
      setPlan(nextPlan);
      setPreviewToken(String(result.previewToken));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
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
      resetSelection();
      await loadSuggestions();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  function resetSelection() {
    setReviewing(false);
    setSelected([]);
    setCanonicalId("");
    setRecommendedId("");
    setEvidence({});
    setPlan(null);
    setAction(null);
    setPreviewToken("");
  }

  function editSelection() {
    setReviewing(false);
    setPlan(null);
    setAction(null);
    setPreviewToken("");
    if (origin === "manual") {
      setManualOpen(true);
      window.setTimeout(() => searchInput.current?.focus(), 0);
    }
  }

  function reviewLater() {
    if (origin === "suggestion" && selected.length === 2) {
      setDeferred(
        (current) =>
          new Set([...current, pairKey(selected[0].id, selected[1].id)]),
      );
      resetSelection();
      return;
    }
    editSelection();
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

      {!reviewing ? (
        <>
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
              <ul className="grid gap-3">
                {visibleSuggestions.map((suggestion) => (
                  <li
                    className="game-inset grid gap-3 p-4"
                    key={pairKey(suggestion.first.id, suggestion.second.id)}
                  >
                    <p className="break-words font-bold">
                      {suggestion.first.name}
                      <span className="text-muted block font-normal sm:inline">
                        {` (${sourceLabel(messages, suggestion.first.identityProvenance)}) ↔ ${suggestion.second.name} (${sourceLabel(messages, suggestion.second.identityProvenance)})`}
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        className="button-primary min-h-11 px-4"
                        type="button"
                        disabled={busy}
                        onClick={() => chooseSuggestion(suggestion)}
                      >
                        {messages.reviewSuggestedPair}
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
                ))}
              </ul>
            )}
          </section>
          <section className="card grid gap-4 p-5">
            <button
              className="button-secondary flex min-h-11 w-full items-center justify-between px-4 text-left"
              type="button"
              aria-expanded={manualOpen}
              aria-controls="manual-coach-selection"
              onClick={() => {
                const next = !manualOpen;
                setManualOpen(next);
                if (next) {
                  window.setTimeout(() => searchInput.current?.focus(), 0);
                }
              }}
            >
              <span>{messages.manualCoachSelection}</span>
              <span aria-hidden="true">{manualOpen ? "−" : "+"}</span>
            </button>
            {manualOpen ? (
              <div id="manual-coach-selection" className="grid gap-4">
                <p className="text-muted text-sm">
                  {messages.manualCoachSelectionHelp}
                </p>
                <label className="grid gap-2">
                  <span>{messages.searchCoaches}</span>
                  <input
                    ref={searchInput}
                    className="game-inset min-h-11 px-3"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                {selected.length > 0 ? (
                  <ul
                    className="flex flex-wrap gap-2"
                    aria-label={messages.selectedIdentities}
                  >
                    {selected.map((coach) => (
                      <li key={coach.id}>
                        <button
                          className="button-utility min-h-11 px-3"
                          type="button"
                          onClick={() => {
                            const next = selected.filter(
                              ({ id }) => id !== coach.id,
                            );
                            setSelected(next);
                            setCanonicalId(next[0]?.id ?? "");
                          }}
                        >
                          {coach.name} · {messages.removeCoach}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
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
                          onClick={() => chooseCoach(coach)}
                        >
                          <PlayerAvatar
                            name={coach.name}
                            photoUrl={coach.photoUrl}
                            size="compact"
                            label={messages.coachAvatar.replace(
                              "{coach}",
                              coach.name,
                            )}
                          />
                          <span className="min-w-0">
                            <strong className="block break-words">
                              {coach.name}
                            </strong>
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
                    {searching
                      ? messages.searchingCoaches
                      : messages.loadMoreCoaches}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <section className="card grid gap-5 p-5" aria-labelledby="coach-review">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{messages.identityReviewStep}</p>
              <h2
                ref={reviewHeading}
                id="coach-review"
                className="score-font mt-1 text-xl outline-none"
                tabIndex={-1}
              >
                {messages.coachIdentityComparison}
              </h2>
            </div>
            <button
              className="button-utility min-h-11 px-4"
              type="button"
              disabled={busy}
              onClick={editSelection}
            >
              {messages.editIdentitySelection}
            </button>
          </div>
          {busy && !plan ? (
            <p className="game-inset p-4" role="status">
              {messages.checkingProtectedHistory}
            </p>
          ) : null}
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 font-bold">
              {messages.chooseCanonicalCoach}
            </legend>
            {selected.map((coach) => (
              <CoachReviewCard
                key={coach.id}
                coach={coach}
                evidence={evidence[coach.id]}
                messages={messages}
                teamName={teamName}
                checked={canonicalId === coach.id}
                recommended={recommendedId === coach.id}
                disabled={
                  Object.values(evidence).filter(
                    ({ hasProtectedHistory }) => hasProtectedHistory,
                  ).length === 1 && !evidence[coach.id]?.hasProtectedHistory
                }
                onChange={() => {
                  setCanonicalId(coach.id);
                  setPlan(null);
                  setAction(null);
                  setPreviewToken("");
                }}
              />
            ))}
          </fieldset>
          {!plan ? (
            <div className="flex flex-wrap gap-3">
              <button
                className="button-primary min-h-11 px-4"
                type="button"
                disabled={!canonicalId || busy}
                onClick={() => void createPreview("match")}
              >
                {messages.samePerson}
              </button>
              <button
                className="button-secondary min-h-11 px-4"
                type="button"
                disabled={!canonicalId || busy}
                onClick={() => void createPreview("nonmatch")}
              >
                {messages.coachesDifferent}
              </button>
              <button
                className="button-utility min-h-11 px-4"
                type="button"
                disabled={busy}
                onClick={reviewLater}
              >
                {messages.reviewLater}
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              <p className="game-inset p-4" role="status">
                <strong>{statusLabel(messages, plan.status)}</strong>
                <span className="mt-1 block">{plan.explanation}</span>
              </p>
              {plan.warnings.map((warning) => (
                <p
                  className="border-warning game-inset p-3 text-sm"
                  key={warning}
                >
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
                  <button
                    className="button-primary min-h-11 px-4"
                    disabled={busy}
                  >
                    {busy
                      ? messages.loading
                      : action?.decision === "match"
                        ? messages.consolidateCoaches
                        : messages.confirmDifferentCoaches}
                  </button>
                </form>
              ) : null}
            </div>
          )}
        </section>
      )}
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

function CoachReviewCard({
  coach,
  evidence,
  messages,
  teamName,
  checked,
  recommended,
  disabled,
  onChange,
}: {
  coach: CoachIdentityOption;
  evidence?: CoachIdentityEvidence;
  messages: AdminMessages;
  teamName: string;
  checked: boolean;
  recommended: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const history = evidence
    ? evidence.hasProtectedHistory
      ? messages.protectedHistory
      : messages.noProtectedHistory
    : messages.protectedHistoryPending;
  const provenance = sourceLabel(messages, coach.identityProvenance);
  return (
    <label
      className={`game-inset grid gap-3 p-4 ${disabled ? "opacity-70" : "cursor-pointer"}`}
    >
      <span className="flex min-h-11 items-start gap-3">
        <input
          className="mt-1"
          type="radio"
          name="canonicalCoach"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
        <span className="break-words font-bold">
          {messages.keepCanonicalIdentity}: {coach.name} — {provenance} ·{" "}
          {history}
        </span>
      </span>
      {recommended ? (
        <span className="status-badge w-fit">
          {messages.recommendedIdentity}
        </span>
      ) : null}
      {disabled ? (
        <span className="text-warning text-sm">
          {messages.unsafeIdentityChoice}
        </span>
      ) : null}
      <PlayerAvatar
        name={coach.name}
        photoUrl={evidence?.photoUrl ?? coach.photoUrl}
        size="profile"
        label={messages.coachAvatar.replace("{coach}", coach.name)}
      />
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-muted">{messages.coachTeams}</dt>
          <dd>
            {coach.teamCount > 0 ? teamName : messages.noCoachAssociation}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{messages.coachMatches}</dt>
          <dd>{coach.matchCount}</dd>
        </div>
        <div>
          <dt className="text-muted">{messages.coachVerifiedAssignments}</dt>
          <dd>
            {evidence
              ? evidence.verifiedAssignments
              : messages.metadataUnavailable}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{messages.reconciliation}</dt>
          <dd>{provenance}</dd>
        </div>
      </dl>
      <span
        className={
          evidence?.hasProtectedHistory ? "text-warning" : "text-muted"
        }
      >
        {history}
      </span>
    </label>
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
