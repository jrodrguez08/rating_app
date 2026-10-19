"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

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
  const [deferredSuggestions, setDeferredSuggestions] = useState<Set<string>>(
    new Set(),
  );
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<AdminPlayerOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [selected, setSelected] = useState<PlayerIdentityOption[]>([]);
  const [canonicalPlayerId, setCanonicalPlayerId] = useState("");
  const [action, setAction] = useState<AdminPlayerIdentityAction | null>(null);
  const [plan, setPlan] = useState<AdminPlayerIdentityPlan | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");

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
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadPlayers(undefined, controller.signal);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadPlayers]);

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

  function choosePlayer(player: PlayerIdentityOption) {
    setPlan(null);
    setAction(null);
    setOutcome("");
    setSelected((current) => {
      if (current.some(({ id }) => id === player.id)) return current;
      const next = current.length === 2 ? [player] : [...current, player];
      setCanonicalPlayerId(next.length === 1 ? next[0].id : "");
      return next;
    });
  }

  function chooseSuggestion(
    suggestion: PlayerIdentitySuggestion,
    decision: "match" | "nonmatch",
  ) {
    const selectedCanonicalPlayerId = isSelectedPair(selected, suggestion)
      ? canonicalPlayerId
      : suggestion.suggestedCanonicalPlayerId;
    void createPreview(
      [suggestion.first, suggestion.second],
      selectedCanonicalPlayerId,
      decision,
    );
  }

  async function createPreview(
    pair: PlayerIdentityOption[],
    canonicalId: string,
    decision: "match" | "nonmatch",
  ) {
    if (pair.length !== 2 || !canonicalId) return;
    const nextAction: AdminPlayerIdentityAction = {
      firstPlayerId: pair[0].id,
      secondPlayerId: pair[1].id,
      canonicalPlayerId: canonicalId,
      trackedTeamId: teamId,
      decision,
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
      setPlan(null);
      setAction(null);
      setSelected([]);
      setCanonicalPlayerId("");
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
      ({ first, second }) =>
        !deferredSuggestions.has(pairKey(first.id, second.id)),
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
          <ul className="grid gap-4">
            {visibleSuggestions.map((suggestion) => (
              <li
                className="game-inset grid gap-4 p-4"
                key={pairKey(suggestion.first.id, suggestion.second.id)}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <PlayerCard
                    messages={messages}
                    player={suggestion.first}
                    teamName={teamName}
                  />
                  <PlayerCard
                    messages={messages}
                    player={suggestion.second}
                    teamName={teamName}
                  />
                </div>
                <fieldset className="grid gap-2">
                  <legend className="font-bold">
                    {messages.chooseCanonicalPlayer}
                  </legend>
                  {[suggestion.first, suggestion.second].map((player) => (
                    <label
                      className="flex min-h-11 items-center gap-3"
                      key={player.id}
                    >
                      <input
                        type="radio"
                        name={`suggestion-${pairKey(suggestion.first.id, suggestion.second.id)}`}
                        checked={
                          isSelectedPair(selected, suggestion) &&
                          canonicalPlayerId === player.id
                        }
                        onChange={() => {
                          setSelected([suggestion.first, suggestion.second]);
                          setCanonicalPlayerId(player.id);
                          setPlan(null);
                          setAction(null);
                        }}
                      />
                      {messages.keepPlayer}: {player.name}
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-wrap gap-3">
                  <button
                    className="button-primary min-h-11 px-4"
                    type="button"
                    disabled={busy || !isSelectedPair(selected, suggestion)}
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
                    {messages.notSamePerson}
                  </button>
                  <button
                    className="button-utility min-h-11 px-4"
                    type="button"
                    onClick={() =>
                      setDeferredSuggestions(
                        (current) =>
                          new Set([
                            ...current,
                            pairKey(suggestion.first.id, suggestion.second.id),
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

      <section className="card grid gap-4 p-5" aria-labelledby="manual-pair">
        <div>
          <h2 id="manual-pair" className="score-font text-xl">
            {messages.manualPlayerSelection}
          </h2>
          <p className="text-muted mt-2 text-sm">
            {messages.manualPlayerSelectionHelp}
          </p>
        </div>
        <label className="grid gap-2">
          <span>{messages.searchPlayers}</span>
          <input
            className="game-inset min-h-11 px-3"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <ul className="game-inset grid max-h-72 gap-2 overflow-auto p-3">
          {players.map((player) => {
            const selectedPlayer = selected.some(({ id }) => id === player.id);
            return (
              <li key={player.id}>
                <button
                  className="button-utility flex min-h-11 w-full items-center gap-3 px-3 text-left"
                  type="button"
                  aria-pressed={selectedPlayer}
                  disabled={selectedPlayer}
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
                    <strong className="block truncate">{player.name}</strong>
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
            onClick={() => void loadPlayers(nextCursor)}
          >
            {searching ? messages.searchingPlayers : messages.loadMorePlayers}
          </button>
        ) : null}

        {selected.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {selected.map((player) => (
              <div className="game-inset grid gap-3 p-4" key={player.id}>
                <PlayerCard
                  messages={messages}
                  player={player}
                  teamName={teamName}
                />
                <button
                  className="button-utility min-h-11 px-3"
                  type="button"
                  onClick={() => {
                    const next = selected.filter(({ id }) => id !== player.id);
                    setSelected(next);
                    setCanonicalPlayerId(next[0]?.id ?? "");
                    setPlan(null);
                    setAction(null);
                  }}
                >
                  {messages.removePlayer}
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {selected.length === 2 ? (
          <fieldset className="game-inset grid gap-3 p-4">
            <legend className="px-2 font-bold">
              {messages.chooseCanonicalPlayer}
            </legend>
            {selected.map((player) => (
              <label
                className="flex min-h-11 items-center gap-3"
                key={player.id}
              >
                <input
                  type="radio"
                  name="canonicalPlayer"
                  checked={canonicalPlayerId === player.id}
                  onChange={() => {
                    setCanonicalPlayerId(player.id);
                    setPlan(null);
                    setAction(null);
                  }}
                />
                {messages.keepPlayer}: {player.name}
              </label>
            ))}
            <div className="flex flex-wrap gap-3">
              <button
                className="button-primary min-h-11 px-4"
                type="button"
                disabled={!canonicalPlayerId || busy}
                onClick={() =>
                  void createPreview(selected, canonicalPlayerId, "match")
                }
              >
                {messages.reviewPair}
              </button>
              <button
                className="button-secondary min-h-11 px-4"
                type="button"
                disabled={!canonicalPlayerId || busy}
                onClick={() =>
                  void createPreview(selected, canonicalPlayerId, "nonmatch")
                }
              >
                {messages.notSamePerson}
              </button>
            </div>
          </fieldset>
        ) : null}
      </section>

      {plan && action ? (
        <section
          className="card grid gap-5 p-5"
          aria-labelledby="identity-plan"
        >
          <h2 id="identity-plan" className="score-font text-xl">
            {messages.identityComparison}
          </h2>
          <p className="game-inset p-4" role="status">
            <strong>{statusLabel(messages, plan.status)}</strong>
            <span className="mt-1 block">{plan.explanation}</span>
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <EvidenceCard
              title={`${messages.keepPlayer}: ${plan.canonical.name}`}
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
                    ? messages.consolidatePlayers
                    : messages.confirmDifferentPlayers}
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

function PlayerCard({
  player,
  messages,
  teamName,
}: {
  player: PlayerIdentityOption;
  messages: AdminMessages;
  teamName: string;
}) {
  return (
    <article className="flex min-w-0 items-center gap-3">
      <PlayerAvatar
        name={player.name}
        photoUrl={player.photoUrl}
        size="compact"
        label={messages.playerAvatar.replace("{player}", player.name)}
      />
      <div className="min-w-0 text-sm">
        <h3 className="break-words font-bold">{player.name}</h3>
        <p className="text-muted">
          {sourceLabel(messages, player.identityProvenance)} · {teamName}
        </p>
        <p className="text-muted">
          {player.position
            ? messages.positions[player.position]
            : messages.metadataUnavailable}
          {player.shirtNumber ? ` · #${player.shirtNumber}` : ""}
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
  value: IdentityEvidence;
  messages: AdminMessages;
  teamName: string;
}) {
  return (
    <article className="game-inset grid gap-3 p-4">
      <PlayerAvatar
        name={value.name}
        photoUrl={value.photoUrl}
        size="profile"
        label={messages.playerAvatar.replace("{player}", value.name)}
      />
      <h3 className="break-words font-bold">{title}</h3>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-muted">{messages.playerTeam}</dt>
          <dd>{teamName}</dd>
        </div>
        <div>
          <dt className="text-muted">{messages.playerPosition}</dt>
          <dd>
            {value.position
              ? messages.positions[value.position]
              : messages.metadataUnavailable}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{messages.playerMatches}</dt>
          <dd>{value.matchCount}</dd>
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

function isSelectedPair(
  selected: PlayerIdentityOption[],
  suggestion: PlayerIdentitySuggestion,
) {
  return (
    selected.length === 2 &&
    pairKey(selected[0].id, selected[1].id) ===
      pairKey(suggestion.first.id, suggestion.second.id)
  );
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
