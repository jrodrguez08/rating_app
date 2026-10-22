"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import type { Messages } from "@/i18n/messages";
import type { AdminPlayerOption } from "@/lib/firebase/admin-console";
import type {
  AdminPlayerIdentityPlan,
  IdentityEvidence,
  PlayerIdentityOption,
  PlayerIdentitySuggestion,
  PlayerIdentitySuggestionResult,
} from "@/lib/firebase/admin-player-identity";
import type { AdminPlayerIdentityAction } from "@/lib/server/admin-player-identity-action";

import { isPlayerSearchResponse } from "./admin-lineup-draft";
import { PlayerAvatar } from "./player-avatar";

type AdminMessages = Messages["admin"];
type SelectionOrigin = "suggestion" | "manual";

export function AdminPlayerIdentityReconciliation({
  messages,
  teamId,
  teamName,
}: {
  messages: AdminMessages;
  teamId: string;
  teamName: string;
}) {
  const [suggestions, setSuggestions] = useState<
    PlayerIdentitySuggestionResult | undefined
  >();
  const [deferred, setDeferred] = useState<Set<string>>(new Set());
  const [manualOpen, setManualOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<AdminPlayerOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [selected, setSelected] = useState<PlayerIdentityOption[]>([]);
  const [origin, setOrigin] = useState<SelectionOrigin>("suggestion");
  const [reviewing, setReviewing] = useState(false);
  const [canonicalId, setCanonicalId] = useState("");
  const [recommendedId, setRecommendedId] = useState("");
  const [evidence, setEvidence] = useState<Record<string, IdentityEvidence>>(
    {},
  );
  const [action, setAction] = useState<AdminPlayerIdentityAction | null>(null);
  const [plan, setPlan] = useState<AdminPlayerIdentityPlan | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const loadSuggestions = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/player-identities/suggestions", {
        cache: "no-store",
      });
      const value: unknown = await response.json();
      if (!response.ok || !isSuggestionResult(value)) throw new Error();
      setSuggestions(value);
    } catch {
      setError(messages.playerSearchError);
    }
  }, [messages.playerSearchError]);

  const loadPlayers = useCallback(
    async (cursor?: string, signal?: AbortSignal) => {
      setSearching(true);
      try {
        const parameters = new URLSearchParams({ query: search.trim() });
        if (cursor) parameters.set("cursor", cursor);
        const response = await fetch(`/api/admin/players?${parameters}`, {
          cache: "no-store",
          signal,
        });
        const value: unknown = await response.json();
        if (!response.ok || !isPlayerSearchResponse(value)) throw new Error();
        setPlayers((current) =>
          cursor
            ? uniquePlayers([...current, ...value.players])
            : value.players,
        );
        setNextCursor(value.nextCursor);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(messages.playerSearchError);
      } finally {
        setSearching(false);
      }
    },
    [messages.playerSearchError, search],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSuggestions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSuggestions]);

  useEffect(() => {
    if (!manualOpen || reviewing) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadPlayers(undefined, controller.signal),
      200,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadPlayers, manualOpen, reviewing]);

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
    pair: PlayerIdentityOption[],
    keeperId: string,
    decision: "match" | "nonmatch",
  ): AdminPlayerIdentityAction {
    return {
      firstPlayerId: pair[0].id,
      secondPlayerId: pair[1].id,
      canonicalPlayerId: keeperId,
      trackedTeamId: teamId,
      decision,
    };
  }

  function rememberEvidence(nextPlan: AdminPlayerIdentityPlan) {
    setEvidence({
      [nextPlan.canonical.playerId]: nextPlan.canonical,
      [nextPlan.duplicate.playerId]: nextPlan.duplicate,
    });
    setRecommendedId(nextPlan.suggestedCanonicalPlayerId);
  }

  async function beginReview(
    pair: PlayerIdentityOption[],
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
        "/api/admin/player-identities/preview",
        buildAction(pair, preferredId, "match"),
      );
      const nextPlan = result.plan as AdminPlayerIdentityPlan;
      rememberEvidence(nextPlan);
      if (pair.some(({ id }) => id === nextPlan.suggestedCanonicalPlayerId)) {
        setCanonicalId(nextPlan.suggestedCanonicalPlayerId);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  function chooseSuggestion(suggestion: PlayerIdentitySuggestion) {
    void beginReview(
      [suggestion.first, suggestion.second],
      suggestion.suggestedCanonicalPlayerId,
      "suggestion",
    );
  }

  function choosePlayer(player: PlayerIdentityOption) {
    if (selected.some(({ id }) => id === player.id)) return;
    const next = [...selected, player].slice(-2);
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
        "/api/admin/player-identities/preview",
        nextAction,
      );
      const nextPlan = result.plan as AdminPlayerIdentityPlan;
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
      await post("/api/admin/player-identities/authorize", {
        action,
        previewToken,
        passphrase: String(new FormData(form).get("passphrase")),
      });
      const result = await post("/api/admin/player-identities/apply", {
        action,
        confirmed: true,
      });
      form.reset();
      setOutcome(
        `${messages.identityReconciliationApplied} ${messages.audit}: ${String(result.auditId)}`,
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
        <p className="eyebrow">{messages.identityReconciliation}</p>
        <h1 className="score-font mt-2 text-2xl">
          {messages.identityReconciliationTitle}
        </h1>
        <p className="text-muted mt-2">{messages.identityReconciliationHelp}</p>
      </header>

      {!reviewing ? (
        <IdentitySelection
          messages={messages}
          suggestions={suggestions}
          visibleSuggestions={visibleSuggestions}
          busy={busy}
          manualOpen={manualOpen}
          setManualOpen={setManualOpen}
          search={search}
          setSearch={setSearch}
          searchInput={searchInput}
          players={players}
          selected={selected}
          chooseSuggestion={chooseSuggestion}
          deferSuggestion={(suggestion) =>
            setDeferred(
              (current) =>
                new Set([
                  ...current,
                  pairKey(suggestion.first.id, suggestion.second.id),
                ]),
            )
          }
          choosePlayer={choosePlayer}
          removePlayer={(playerId) => {
            const next = selected.filter(({ id }) => id !== playerId);
            setSelected(next);
            setCanonicalId(next[0]?.id ?? "");
          }}
          nextCursor={nextCursor}
          searching={searching}
          loadMore={() => void loadPlayers(nextCursor)}
        />
      ) : (
        <section
          className="card grid gap-5 p-5"
          aria-labelledby="identity-review"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{messages.identityReviewStep}</p>
              <h2
                ref={reviewHeading}
                id="identity-review"
                className="score-font mt-1 text-xl outline-none"
                tabIndex={-1}
              >
                {messages.identityComparison}
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
              {messages.chooseCanonicalPlayer}
            </legend>
            {selected.map((player) => (
              <PlayerReviewCard
                key={player.id}
                player={player}
                evidence={evidence[player.id]}
                messages={messages}
                teamName={teamName}
                checked={canonicalId === player.id}
                recommended={recommendedId === player.id}
                disabled={
                  Object.values(evidence).filter(
                    ({ hasProtectedHistory }) => hasProtectedHistory,
                  ).length === 1 && !evidence[player.id]?.hasProtectedHistory
                }
                onChange={() => {
                  setCanonicalId(player.id);
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
                {messages.notSamePerson}
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
            <Authorization
              messages={messages}
              action={action}
              plan={plan}
              busy={busy}
              onSubmit={confirmDecision}
            />
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

function IdentitySelection({
  messages,
  suggestions,
  visibleSuggestions,
  busy,
  manualOpen,
  setManualOpen,
  search,
  setSearch,
  searchInput,
  players,
  selected,
  chooseSuggestion,
  deferSuggestion,
  choosePlayer,
  removePlayer,
  nextCursor,
  searching,
  loadMore,
}: {
  messages: AdminMessages;
  suggestions?: PlayerIdentitySuggestionResult;
  visibleSuggestions: PlayerIdentitySuggestion[];
  busy: boolean;
  manualOpen: boolean;
  setManualOpen: (value: boolean) => void;
  search: string;
  setSearch: (value: string) => void;
  searchInput: RefObject<HTMLInputElement | null>;
  players: AdminPlayerOption[];
  selected: PlayerIdentityOption[];
  chooseSuggestion: (suggestion: PlayerIdentitySuggestion) => void;
  deferSuggestion: (suggestion: PlayerIdentitySuggestion) => void;
  choosePlayer: (player: PlayerIdentityOption) => void;
  removePlayer: (playerId: string) => void;
  nextCursor?: string;
  searching: boolean;
  loadMore: () => void;
}) {
  return (
    <>
      <section className="card grid gap-4 p-5" aria-labelledby="suggestions">
        <div>
          <h2 id="suggestions" className="score-font text-xl">
            {messages.possibleDuplicates}
          </h2>
          <p className="text-muted mt-2 text-sm">
            {messages.possibleDuplicatesHelp}
          </p>
        </div>
        {!suggestions ? (
          <p role="status">{messages.loading}</p>
        ) : visibleSuggestions.length === 0 ? (
          <p className="game-inset p-4" role="status">
            {suggestions.providerDataAvailable
              ? messages.noPendingDuplicates
              : messages.waitingForProviderPlayers}
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
                    onClick={() => deferSuggestion(suggestion)}
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
          aria-controls="manual-player-selection"
          onClick={() => {
            const next = !manualOpen;
            setManualOpen(next);
            if (next) window.setTimeout(() => searchInput.current?.focus(), 0);
          }}
        >
          <span>{messages.manualPlayerSelection}</span>
          <span aria-hidden="true">{manualOpen ? "−" : "+"}</span>
        </button>
        {manualOpen ? (
          <div id="manual-player-selection" className="grid gap-4">
            <p className="text-muted text-sm">
              {messages.manualPlayerSelectionHelp}
            </p>
            <label className="grid gap-2">
              <span>{messages.searchPlayers}</span>
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
                {selected.map((player) => (
                  <li key={player.id}>
                    <button
                      className="button-utility min-h-11 px-3"
                      type="button"
                      onClick={() => removePlayer(player.id)}
                    >
                      {player.name} · {messages.removePlayer}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="game-inset grid max-h-72 gap-2 overflow-auto p-3">
              {players.map((player) => {
                const chosen = selected.some(({ id }) => id === player.id);
                return (
                  <li key={player.id}>
                    <button
                      className="button-utility flex min-h-11 w-full items-center gap-3 px-3 text-left"
                      type="button"
                      aria-pressed={chosen}
                      disabled={chosen}
                      onClick={() => choosePlayer(player)}
                    >
                      <PlayerAvatar
                        name={player.name}
                        photoUrl={player.photoUrl}
                        size="compact"
                        label={messages.playerAvatar.replace(
                          "{player}",
                          player.name,
                        )}
                      />
                      <span className="min-w-0">
                        <strong className="block break-words">
                          {player.name}
                        </strong>
                        <span className="text-muted text-sm">
                          {sourceLabel(messages, player.identityProvenance)}
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
                onClick={loadMore}
              >
                {searching
                  ? messages.searchingPlayers
                  : messages.loadMorePlayers}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

function PlayerReviewCard({
  player,
  evidence,
  messages,
  teamName,
  checked,
  recommended,
  disabled,
  onChange,
}: {
  player: PlayerIdentityOption;
  evidence?: IdentityEvidence;
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
  const provenance = sourceLabel(messages, player.identityProvenance);
  return (
    <label
      className={`game-inset grid gap-3 p-4 ${disabled ? "opacity-70" : "cursor-pointer"}`}
    >
      <span className="flex min-h-11 items-start gap-3">
        <input
          className="mt-1"
          type="radio"
          name="canonicalPlayer"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
        <span className="break-words font-bold">
          {messages.keepCanonicalIdentity}: {player.name} — {provenance} ·{" "}
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
        name={player.name}
        photoUrl={evidence?.photoUrl ?? player.photoUrl}
        size="profile"
        label={messages.playerAvatar.replace("{player}", player.name)}
      />
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-muted">{messages.playerTeam}</dt>
          <dd>{teamName}</dd>
        </div>
        <div>
          <dt className="text-muted">{messages.playerPosition}</dt>
          <dd>
            {player.position
              ? messages.positions[player.position]
              : messages.metadataUnavailable}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{messages.playerMatches}</dt>
          <dd>
            {evidence ? evidence.matchCount : messages.metadataUnavailable}
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

function Authorization({
  messages,
  action,
  plan,
  busy,
  onSubmit,
}: {
  messages: AdminMessages;
  action: AdminPlayerIdentityAction | null;
  plan: AdminPlayerIdentityPlan;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="game-inset p-4" role="status">
        <strong>{statusLabel(messages, plan.status)}</strong>
        <span className="mt-1 block">{plan.explanation}</span>
      </p>
      {plan.warnings.map((warning) => (
        <p className="border-warning game-inset p-3 text-sm" key={warning}>
          {warning}
        </p>
      ))}
      {plan.canApply ? (
        <form className="grid gap-3" onSubmit={onSubmit}>
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
              : action?.decision === "match"
                ? messages.consolidatePlayers
                : messages.confirmDifferentPlayers}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function sourceLabel(
  messages: AdminMessages,
  provenance: PlayerIdentityOption["identityProvenance"],
) {
  return provenance === "operator_verified"
    ? messages.sourceManual
    : messages.sourceProvider;
}

function statusLabel(
  messages: AdminMessages,
  status: AdminPlayerIdentityPlan["status"],
) {
  return {
    safe: messages.safeIdentityLink,
    already_linked: messages.alreadyLinkedPlayers,
    confirmed_different: messages.confirmedDifferentPlayers,
    insufficient_evidence: messages.insufficientIdentityEvidence,
    history_conflict: messages.conflictingPlayerHistory,
  }[status];
}

function pairKey(first: string, second: string) {
  return [first, second].sort().join(":");
}

function uniquePlayers(players: AdminPlayerOption[]) {
  return [...new Map(players.map((player) => [player.id, player])).values()];
}

function isSuggestionResult(
  value: unknown,
): value is PlayerIdentitySuggestionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "providerDataAvailable" in value &&
    typeof value.providerDataAvailable === "boolean" &&
    "suggestions" in value &&
    Array.isArray(value.suggestions)
  );
}
