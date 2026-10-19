"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { Messages } from "@/i18n/messages";
import type {
  AdminMatchDetail,
  AdminPlayerOption,
} from "@/lib/firebase/admin-console";
import type { AdminLineupAction } from "@/lib/server/admin-lineup-action";

import {
  buildInitialParticipants,
  countLane,
  describeChanges,
  isLane,
  isPlayerSearchResponse,
  laneFor,
  mergePlayers,
  participantForLane,
  type EditableParticipant,
  type LineupLane,
} from "./admin-lineup-draft";
import {
  LineupGroup,
  lineupLaneTitle,
  RosterResult,
} from "./admin-lineup-workspace";

type AdminMessages = Messages["admin"];

class AdminApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export function AdminLineupEditor({
  detail,
  messages,
  teamId,
}: {
  detail: AdminMatchDetail;
  messages: AdminMessages;
  teamId: string;
}) {
  const router = useRouter();
  const initialParticipants = useMemo(
    () => buildInitialParticipants(detail),
    [detail],
  );
  const [savedParticipants, setSavedParticipants] =
    useState(initialParticipants);
  const [participants, setParticipants] = useState(initialParticipants);
  const [draftVersion, setDraftVersion] = useState(detail.draft?.version ?? 0);
  const [draftStatus, setDraftStatus] = useState<
    "saved" | "saving" | "unsaved" | "error"
  >(detail.draft ? "saved" : "unsaved");
  const [knownPlayers, setKnownPlayers] = useState(detail.players);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<AdminPlayerOption[]>([]);
  const [searchCursor, setSearchCursor] = useState<string | undefined>();
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchComplete, setSearchComplete] = useState(false);
  const [internalName, setInternalName] = useState("");
  const [internalPosition, setInternalPosition] = useState("");
  const [internalShirtNumber, setInternalShirtNumber] = useState("");
  const [internalVerified, setInternalVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string>();
  const [outcome, setOutcome] = useState("");
  const [interactionStatus, setInteractionStatus] = useState(
    messages.preloadSummary
      .replace("{starters}", String(countLane(initialParticipants, "starters")))
      .replace(
        "{substitutes}",
        String(
          initialParticipants.length -
            countLane(initialParticipants, "starters"),
        ),
      ),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const editable = ["not_ready", "preparing_rating"].includes(
    detail.match.ratingState,
  );
  const selectedIds = useMemo(
    () => new Set(participants.map(({ playerId }) => playerId)),
    [participants],
  );
  const metadata = useMemo(
    () => new Map(knownPlayers.map((player) => [player.id, player])),
    [knownPlayers],
  );
  const starters = participants.filter(
    (participant) => laneFor(participant) === "starters",
  );
  const changes = useMemo(
    () => describeChanges(savedParticipants, participants),
    [participants, savedParticipants],
  );
  const hasUnsavedChanges = changes.length > 0 || draftVersion === 0;
  const action: AdminLineupAction = {
    matchId: detail.match.id,
    trackedTeamId: teamId,
    externalFixtureId: detail.match.externalFixtureId,
    participants: participants.map((participant) => {
      const canonical = metadata.get(participant.playerId);
      return !participant.createInternalIdentity && canonical
        ? { ...participant, playerName: canonical.name }
        : participant;
    }),
    verificationSource: "authenticated-owner",
    verificationReason:
      "Participación confirmada por el propietario autenticado.",
  };
  const draftAction = {
    matchId: detail.match.id,
    trackedTeamId: teamId,
    externalFixtureId: detail.match.externalFixtureId,
    baseVersion: draftVersion,
    participants,
  };

  useEffect(() => {
    const query = search.trim();
    if (!editable) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        setSearchLoading(true);
        try {
          const response = await fetch(
            `/api/admin/players?query=${encodeURIComponent(query)}`,
            { cache: "no-store", signal: controller.signal },
          );
          const value: unknown = await response.json();
          if (!response.ok || !isPlayerSearchResponse(value)) throw new Error();
          setSearchResults(
            value.players.filter((player) => !selectedIds.has(player.id)),
          );
          setSearchCursor(value.nextCursor);
          setKnownPlayers((current) => mergePlayers(current, value.players));
          setSearchComplete(true);
        } catch (caught) {
          if (caught instanceof DOMException && caught.name === "AbortError")
            return;
          setError(messages.playerSearchError);
          setSearchResults([]);
          setSearchCursor(undefined);
          setSearchComplete(true);
        } finally {
          if (!controller.signal.aborted) setSearchLoading(false);
        }
      },
      query.length === 0 ? 0 : 200,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editable, messages.playerSearchError, search, selectedIds]);

  async function loadMorePlayers() {
    if (!searchCursor || searchLoading) return;
    setSearchLoading(true);
    setError("");
    try {
      const parameters = new URLSearchParams({
        query: search.trim(),
        cursor: searchCursor,
      });
      const response = await fetch(`/api/admin/players?${parameters}`, {
        cache: "no-store",
      });
      const value: unknown = await response.json();
      if (!response.ok || !isPlayerSearchResponse(value)) throw new Error();
      const available = value.players.filter(
        (player) => !selectedIds.has(player.id),
      );
      setSearchResults((current) => mergePlayers(current, available));
      setKnownPlayers((current) => mergePlayers(current, value.players));
      setSearchCursor(value.nextCursor);
    } catch {
      setError(messages.playerSearchError);
    } finally {
      setSearchLoading(false);
    }
  }

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart({ active }) {
        return messages.dragStarted.replace(
          "{player}",
          playerName(participants, String(active.id)),
        );
      },
      onDragOver({ active, over }) {
        if (!over || !isLane(over.id)) return messages.dragCancelled;
        return messages.dragOver
          .replace("{player}", playerName(participants, String(active.id)))
          .replace("{group}", lineupLaneTitle(String(over.id), messages));
      },
      onDragEnd({ active, over }) {
        if (!over || !isLane(over.id)) return messages.dragCancelled;
        return messages.playerMoved
          .replace("{player}", playerName(participants, String(active.id)))
          .replace("{group}", lineupLaneTitle(String(over.id), messages));
      },
      onDragCancel() {
        return messages.dragCancelled;
      },
    }),
    [messages, participants],
  );

  async function post(path: string, body: unknown) {
    setError("");
    setErrorCode(undefined);
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
      const code =
        typeof result === "object" &&
        result !== null &&
        "code" in result &&
        typeof result.code === "string"
          ? result.code
          : undefined;
      throw new AdminApiError(message, code);
    }
    return result as Record<string, unknown>;
  }

  function resetAuthorization() {
    setOutcome("");
  }

  function replaceParticipants(next: EditableParticipant[], status: string) {
    setParticipants(next);
    setDraftStatus("unsaved");
    setInteractionStatus(status);
    setError("");
    setErrorCode(undefined);
    resetAuthorization();
  }

  function addPlayer(player: AdminPlayerOption, lane: LineupLane) {
    if (selectedIds.has(player.id)) {
      setError(messages.duplicatePlayerError);
      return;
    }
    if (lane === "starters" && starters.length >= 11) {
      setError(messages.starterLimitError);
      return;
    }
    const participant = participantForLane(
      {
        playerId: player.id,
        playerName: player.name,
        createInternalIdentity: false,
        evidenceProvenance: "operator_verified",
        ...(player.shirtNumber === undefined
          ? {}
          : { shirtNumber: player.shirtNumber }),
        ...(player.position === undefined ? {} : { position: player.position }),
      },
      lane,
    );
    replaceParticipants(
      [...participants, participant],
      movedMessage(participant.playerName, lane, messages),
    );
    setSearch("");
    setSearchResults([]);
  }

  async function addInternalPlayer(lane: LineupLane) {
    const playerNameValue = internalName.trim();
    if (!internalVerified || !playerNameValue || busy) return;
    if (lane === "starters" && starters.length >= 11) {
      setError(messages.starterLimitError);
      return;
    }
    setBusy(true);
    try {
      const allocation = await post("/api/admin/players/internal-id", {
        matchId: detail.match.id,
        trackedTeamId: teamId,
      });
      const playerId = String(allocation.playerId ?? "");
      const identityAllocationToken = String(
        allocation.identityAllocationToken ?? "",
      );
      if (!playerId || !identityAllocationToken) throw new Error();
      const shirtNumber = internalShirtNumber
        ? Number(internalShirtNumber)
        : undefined;
      const participant = participantForLane(
        {
          playerId,
          playerName: playerNameValue,
          createInternalIdentity: true,
          identityAllocationToken,
          evidenceProvenance: "operator_verified",
          ...(internalPosition
            ? {
                position: internalPosition as EditableParticipant["position"],
              }
            : {}),
          ...(shirtNumber === undefined ? {} : { shirtNumber }),
        },
        lane,
      );
      setKnownPlayers((current) =>
        mergePlayers(current, [
          {
            id: playerId,
            name: playerNameValue,
            identityProvenance: "operator_verified",
            ...(participant.position ? { position: participant.position } : {}),
            ...(shirtNumber === undefined ? {} : { shirtNumber }),
          },
        ]),
      );
      replaceParticipants(
        [...participants, participant],
        movedMessage(playerNameValue, lane, messages),
      );
      setInternalName("");
      setInternalPosition("");
      setInternalShirtNumber("");
      setInternalVerified(false);
    } catch (caught) {
      setErrorCode(caught instanceof AdminApiError ? caught.code : undefined);
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  async function recoverInternalIdentities() {
    setBusy(true);
    try {
      const result = await post("/api/admin/players/internal-id/recover", {
        matchId: detail.match.id,
        trackedTeamId: teamId,
        externalFixtureId: detail.match.externalFixtureId,
      });
      const allocations = Array.isArray(result.allocations)
        ? result.allocations
        : [];
      const tokens = new Map<string, string>();
      for (const allocation of allocations) {
        if (
          typeof allocation === "object" &&
          allocation !== null &&
          "playerId" in allocation &&
          typeof allocation.playerId === "string" &&
          "identityAllocationToken" in allocation &&
          typeof allocation.identityAllocationToken === "string"
        ) {
          tokens.set(allocation.playerId, allocation.identityAllocationToken);
        }
      }
      const next = participants.map((participant) => {
        const token = tokens.get(participant.playerId);
        return token
          ? { ...participant, identityAllocationToken: token }
          : participant;
      });
      const nextVersion = Number(result.version);
      if (!Number.isInteger(nextVersion) || nextVersion <= draftVersion) {
        throw new Error(messages.genericError);
      }
      setParticipants(next);
      setSavedParticipants((current) =>
        current.map((participant) => {
          const token = tokens.get(participant.playerId);
          return token
            ? { ...participant, identityAllocationToken: token }
            : participant;
        }),
      );
      setDraftVersion(nextVersion);
      setDraftStatus(changes.length === 0 ? "saved" : "unsaved");
      setInteractionStatus(messages.internalIdentitiesRecovered);
      setErrorCode(undefined);
      resetAuthorization();
    } catch (caught) {
      setErrorCode(caught instanceof AdminApiError ? caught.code : undefined);
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  function movePlayer(playerId: string, lane: LineupLane) {
    const current = participants.find(
      (participant) => participant.playerId === playerId,
    );
    if (!current || laneFor(current) === lane) return;
    if (lane === "starters" && starters.length >= 11) {
      setError(messages.starterLimitError);
      setInteractionStatus(messages.starterLimitError);
      return;
    }
    replaceParticipants(
      participants.map((participant) =>
        participant.playerId === playerId
          ? participantForLane(participant, lane)
          : participant,
      ),
      movedMessage(current.playerName, lane, messages),
    );
  }

  function updateEntryMinute(playerId: string, enteredAtMinute?: number) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.playerId === playerId
          ? { ...participant, enteredAtMinute }
          : participant,
      ),
    );
    setDraftStatus("unsaved");
    setError("");
    resetAuthorization();
  }

  function removePlayer(playerId: string) {
    const current = participants.find(
      (participant) => participant.playerId === playerId,
    );
    if (!current) return;
    replaceParticipants(
      participants.filter((participant) => participant.playerId !== playerId),
      messages.playerRemoved.replace("{player}", current.playerName),
    );
  }

  function resetDraft() {
    replaceParticipants(savedParticipants, messages.draftRestored);
    setDraftStatus(detail.draft || draftVersion > 0 ? "saved" : "unsaved");
  }

  async function saveDraft() {
    setDraftStatus("saving");
    setError("");
    try {
      const result = await post("/api/admin/lineup-draft", draftAction);
      const nextVersion = Number(result.version);
      if (!Number.isInteger(nextVersion) || nextVersion <= 0) throw new Error();
      setDraftVersion(nextVersion);
      setSavedParticipants(participants);
      setDraftStatus("saved");
      setInteractionStatus(messages.draftSaved);
    } catch (caught) {
      setDraftStatus("error");
      setError(
        caught instanceof Error ? caught.message : messages.draftSaveError,
      );
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (event.over && isLane(event.over.id)) {
      movePlayer(String(event.active.id), event.over.id);
    } else {
      setInteractionStatus(messages.dragCancelled);
    }
  }

  async function confirmLineup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    try {
      const preview = await post("/api/admin/lineup/preview", action);
      await post("/api/admin/lineup/authorize", {
        action,
        previewToken: preview.previewToken,
        passphrase: String(new FormData(form).get("passphrase")),
      });
      const result = await post("/api/admin/lineup/apply", {
        action,
        confirmation: `prepare-verified-lineup:${action.matchId}`,
      });
      setOutcome(
        `${messages.lineupApplied} ${messages.audit}: ${String(result.auditId)}`,
      );
      router.refresh();
    } catch (caught) {
      setErrorCode(caught instanceof AdminApiError ? caught.code : undefined);
      setError(
        caught instanceof Error ? caught.message : messages.genericError,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Link className="button-utility w-fit px-4 py-3" href="/admin">
        {messages.backToConsole}
      </Link>
      <MatchSummary detail={detail} messages={messages} />

      {!editable ? (
        <section className="card p-5" role="status">
          {messages.historicalReadOnly}
        </section>
      ) : (
        <div className="grid gap-6">
          <section className="card grid gap-4 p-5">
            <div>
              <p className="eyebrow">{messages.canonicalRoster}</p>
              <h2 className="score-font mt-2 text-xl">
                {messages.playerSelection}
              </h2>
            </div>
            <label className="grid gap-2">
              <span>{messages.searchPlayers}</span>
              <input
                className="game-inset min-h-11 px-3"
                type="search"
                value={search}
                onChange={(event) => {
                  const value = event.target.value;
                  setSearch(value);
                  setSearchComplete(false);
                }}
                aria-describedby="player-search-status"
              />
            </label>
            <p
              id="player-search-status"
              className="text-muted text-sm"
              role="status"
              aria-live="polite"
            >
              {searchLoading
                ? messages.searchingPlayers
                : searchComplete && searchResults.length === 0
                  ? messages.noPlayers
                  : messages.searchPlayersHelp}
            </p>
            {searchResults.length > 0 ? (
              <ul className="game-inset grid max-h-72 gap-2 overflow-auto p-3">
                {searchResults.map((player) => (
                  <RosterResult
                    key={player.id}
                    player={player}
                    messages={messages}
                    starterDisabled={starters.length >= 11}
                    add={addPlayer}
                  />
                ))}
              </ul>
            ) : null}
            {searchCursor ? (
              <button
                className="button-utility min-h-11 w-fit px-4"
                type="button"
                disabled={searchLoading}
                onClick={loadMorePlayers}
              >
                {searchLoading
                  ? messages.searchingPlayers
                  : messages.loadMorePlayers}
              </button>
            ) : null}
            <details className="game-inset p-4">
              <summary className="cursor-pointer font-bold">
                {messages.newPlayer}
              </summary>
              <div className="mt-4 grid gap-3">
                <strong>{messages.internalIdentity}</strong>
                <p className="text-muted text-sm">
                  {messages.internalIdentityHelp}
                </p>
                <label className="grid gap-2">
                  <span>{messages.playerName}</span>
                  <input
                    className="game-inset min-h-11 px-3"
                    value={internalName}
                    onChange={(event) => {
                      setInternalName(event.target.value);
                      setSearch(event.target.value);
                      setSearchComplete(false);
                    }}
                    required
                  />
                </label>
                {internalName.trim() && searchResults.length > 0 ? (
                  <p className="text-warning text-sm" role="status">
                    {messages.potentialDuplicates}
                  </p>
                ) : null}
                <label className="grid gap-2">
                  <span>{messages.playerPosition}</span>
                  <select
                    className="game-inset min-h-11 px-3"
                    value={internalPosition}
                    onChange={(event) =>
                      setInternalPosition(event.target.value)
                    }
                  >
                    <option value="">{messages.optionalField}</option>
                    {Object.entries(messages.positions).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span>{messages.shirtNumber}</span>
                  <input
                    className="game-inset min-h-11 px-3"
                    type="number"
                    min="1"
                    max="99"
                    value={internalShirtNumber}
                    onChange={(event) =>
                      setInternalShirtNumber(event.target.value)
                    }
                  />
                </label>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={internalVerified}
                    onChange={(event) =>
                      setInternalVerified(event.target.checked)
                    }
                  />
                  <span>{messages.internalIdentityConfirmation}</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="button-utility min-h-11 px-3"
                    type="button"
                    disabled={
                      !internalName ||
                      !internalVerified ||
                      busy ||
                      starters.length >= 11
                    }
                    onClick={() => void addInternalPlayer("starters")}
                  >
                    {messages.addStarter}
                  </button>
                  <button
                    className="button-utility min-h-11 px-3"
                    type="button"
                    disabled={!internalName || !internalVerified || busy}
                    onClick={() => void addInternalPlayer("available")}
                  >
                    {messages.addSubstitute}
                  </button>
                </div>
              </div>
            </details>
          </section>

          <DndContext
            sensors={sensors}
            onDragEnd={handleDragEnd}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable: messages.dragInstructions,
              },
            }}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {(
                ["starters", "available", "entered", "unconfirmed"] as const
              ).map((lane) => (
                <LineupGroup
                  key={lane}
                  lane={lane}
                  participants={participants.filter(
                    (participant) => laneFor(participant) === lane,
                  )}
                  metadata={metadata}
                  messages={messages}
                  starterCount={starters.length}
                  move={movePlayer}
                  remove={removePlayer}
                  updateEntryMinute={updateEntryMinute}
                />
              ))}
            </div>
          </DndContext>

          <div
            className="game-inset flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
            role="status"
            aria-live="polite"
          >
            <span>{interactionStatus}</span>
            <button
              className="button-utility min-h-11 px-3"
              type="button"
              disabled={changes.length === 0}
              onClick={resetDraft}
            >
              {messages.restorePreload}
            </button>
          </div>

          <section className="card grid gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">{messages.draftTitle}</p>
                <p className="text-muted mt-2 text-sm">{messages.draftHelp}</p>
              </div>
              <span className="status-badge" role="status" aria-live="polite">
                {messages.draftStatuses[draftStatus]}
              </span>
            </div>
            <button
              className="button-primary min-h-11 px-4"
              type="button"
              disabled={draftStatus === "saving" || !hasUnsavedChanges}
              onClick={saveDraft}
            >
              {draftStatus === "saving"
                ? messages.savingDraft
                : messages.saveDraft}
            </button>
          </section>

          <section className="card p-5">
            <form className="grid gap-4" onSubmit={confirmLineup}>
              <p className="eyebrow">1–2 / 4</p>
              <h2 className="score-font text-xl">
                {messages.confirmVerifiedLineup}
              </h2>
              <div className="game-inset grid gap-2 p-4 text-sm">
                <strong>{messages.verificationSummary}</strong>
                <span>
                  {detail.match.homeTeamName} {messages.versus}{" "}
                  {detail.match.awayTeamName}
                </span>
                <span>
                  {messages.previewParticipants
                    .replace("{starters}", String(starters.length))
                    .replace(
                      "{substitutes}",
                      String(participants.length - starters.length),
                    )
                    .replace(
                      "{entered}",
                      String(countLane(participants, "entered")),
                    )}
                </span>
              </div>
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
              {starters.length !== 11 ? (
                <p className="text-warning" role="status">
                  {messages.exactStartersRequired.replace(
                    "{count}",
                    String(starters.length),
                  )}
                </p>
              ) : null}
              <button
                className="button-primary min-h-11 px-4"
                type="submit"
                disabled={busy || starters.length !== 11}
              >
                {busy ? messages.loading : messages.applyLineup}
              </button>
            </form>
          </section>
        </div>
      )}
      {error ? (
        <div className="card grid gap-3 border-danger p-4 text-danger">
          <p role="alert">{error}</p>
          {errorCode === "LINEUP_INTERNAL_IDENTITY_INVALID" ? (
            <button
              className="button-utility min-h-11 w-fit px-3"
              type="button"
              disabled={busy}
              onClick={() => void recoverInternalIdentities()}
            >
              {busy
                ? messages.recoveringInternalIdentities
                : messages.recoverInternalIdentities}
            </button>
          ) : null}
        </div>
      ) : null}
      {outcome ? (
        <p className="card border-success p-4 text-success" role="status">
          {outcome}
        </p>
      ) : null}
    </div>
  );
}

function MatchSummary({
  detail,
  messages,
}: {
  detail: AdminMatchDetail;
  messages: AdminMessages;
}) {
  return (
    <section className="card grid gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{messages.matchOperation}</p>
          <h2 className="mt-2 text-xl font-bold">
            {detail.match.homeTeamName} {messages.versus}{" "}
            {detail.match.awayTeamName}
          </h2>
        </div>
        <span className="status-badge">
          {messages.statuses[detail.match.status]}
        </span>
      </div>
      <div className="game-inset grid gap-1 p-4 text-sm">
        <span>
          {messages.fixture}: {detail.match.externalFixtureId}
        </span>
        <span>
          {messages.lifecycle}:{" "}
          {messages.ratingStates[detail.match.ratingState]}
        </span>
        <span>
          {messages.currentAssignment}:{" "}
          {detail.match.assignment?.coachName ?? messages.none}
        </span>
        <span>
          {messages.lineupEvidence}:{" "}
          {detail.match.verifiedLineup
            ? messages.verifiedPreparation
            : detail.match.lineupSnapshotAt
              ? messages.providerPreparation
              : messages.none}
        </span>
        {detail.match.verifiedLineup ? (
          <>
            <a
              className="break-all underline"
              href={detail.match.verifiedLineup.verificationSource}
              rel="noreferrer"
              target="_blank"
            >
              {detail.match.verifiedLineup.verificationSource}
            </a>
            <span>{detail.match.verifiedLineup.verificationReason}</span>
          </>
        ) : null}
        {detail.reconciliation ? (
          <span>
            {messages.reconciliation}:{" "}
            {messages.reconciliationStatuses[detail.reconciliation.status]}
          </span>
        ) : null}
      </div>
      <p className="text-muted text-sm">{messages.lifecycleOwnsVoting}</p>
    </section>
  );
}

function movedMessage(
  name: string,
  lane: LineupLane,
  messages: AdminMessages,
): string {
  return messages.playerMoved
    .replace("{player}", name)
    .replace("{group}", lineupLaneTitle(lane, messages));
}

function playerName(
  participants: EditableParticipant[],
  playerId: string,
): string {
  return (
    participants.find((participant) => participant.playerId === playerId)
      ?.playerName ?? playerId
  );
}
