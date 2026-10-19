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
  type LineupChange,
  type LineupLane,
} from "./admin-lineup-draft";
import {
  LineupGroup,
  lineupLaneTitle,
  RosterResult,
} from "./admin-lineup-workspace";

type AdminMessages = Messages["admin"];
export function AdminLineupEditor({
  detail,
  messages,
  teamId,
}: {
  detail: AdminMatchDetail;
  messages: AdminMessages;
  teamId: string;
}) {
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
  const [internalId, setInternalId] = useState("");
  const [internalName, setInternalName] = useState("");
  const [internalVerified, setInternalVerified] = useState(false);
  const [evidence, setEvidence] = useState(
    detail.match.verifiedLineup?.verificationSource ?? "",
  );
  const [reason, setReason] = useState(
    detail.match.verifiedLineup?.verificationReason ?? "",
  );
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    participants,
    verificationSource: evidence,
    verificationReason: reason,
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

  function resetAuthorization() {
    setPreview(null);
    setAuthorized(false);
    setConfirmation("");
    setOutcome("");
  }

  function replaceParticipants(next: EditableParticipant[], status: string) {
    setParticipants(next);
    setDraftStatus("unsaved");
    setInteractionStatus(status);
    setError("");
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

  function addInternalPlayer(lane: LineupLane) {
    const playerId = internalId.trim();
    const playerNameValue = internalName.trim();
    if (!internalVerified || !playerId || !playerNameValue) return;
    if (selectedIds.has(playerId)) {
      setError(messages.duplicatePlayerError);
      return;
    }
    if (lane === "starters" && starters.length >= 11) {
      setError(messages.starterLimitError);
      return;
    }
    const participant = participantForLane(
      {
        playerId,
        playerName: playerNameValue,
        createInternalIdentity: true,
        evidenceProvenance: "operator_verified",
      },
      lane,
    );
    setKnownPlayers((current) =>
      mergePlayers(current, [
        {
          id: playerId,
          name: playerNameValue,
          identityProvenance: "operator_verified",
        },
      ]),
    );
    replaceParticipants(
      [...participants, participant],
      movedMessage(playerNameValue, lane, messages),
    );
    setInternalId("");
    setInternalName("");
    setInternalVerified(false);
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

  async function createPreview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await post("/api/admin/lineup/preview", action);
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
    setBusy(true);
    try {
      const passphrase = String(
        new FormData(event.currentTarget).get("passphrase"),
      );
      await post("/api/admin/lineup/authorize", {
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
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const result = await post("/api/admin/lineup/apply", {
        action,
        confirmation,
      });
      setOutcome(
        `${messages.lineupApplied} ${messages.audit}: ${String(result.auditId)}`,
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
                {messages.advancedActions}
              </summary>
              <div className="mt-4 grid gap-3">
                <strong>{messages.internalIdentity}</strong>
                <p className="text-muted text-sm">
                  {messages.internalIdentityHelp}
                </p>
                <label className="grid gap-2">
                  <span>{messages.internalPlayerId}</span>
                  <input
                    className="game-inset min-h-11 px-3"
                    value={internalId}
                    onChange={(event) => setInternalId(event.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span>{messages.playerName}</span>
                  <input
                    className="game-inset min-h-11 px-3"
                    value={internalName}
                    onChange={(event) => setInternalName(event.target.value)}
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
                      !internalId ||
                      !internalName ||
                      !internalVerified ||
                      starters.length >= 11
                    }
                    onClick={() => addInternalPlayer("starters")}
                  >
                    {messages.addStarter}
                  </button>
                  <button
                    className="button-utility min-h-11 px-3"
                    type="button"
                    disabled={!internalId || !internalName || !internalVerified}
                    onClick={() => addInternalPlayer("available")}
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

          <details className="card p-5">
            <summary className="cursor-pointer font-bold">
              {messages.confirmVerifiedLineup}
            </summary>
            <form className="mt-4 grid gap-4" onSubmit={createPreview}>
              <div className="game-inset grid gap-2 p-4 text-sm">
                <strong>{messages.verificationSummary}</strong>
                <span>
                  {detail.match.homeTeamName} {messages.versus}{" "}
                  {detail.match.awayTeamName}
                </span>
                <span>
                  {messages.fixture}: {detail.match.externalFixtureId}
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
                <span>{messages.verificationAuthorityHelp}</span>
              </div>
              <h2 className="score-font text-xl">{messages.evidenceTitle}</h2>
              <label className="grid gap-2">
                <span>{messages.evidence}</span>
                <input
                  className="game-inset min-h-11 px-3"
                  type="url"
                  value={evidence}
                  onChange={(event) => {
                    setEvidence(event.target.value);
                    resetAuthorization();
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
                    resetAuthorization();
                  }}
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
                className="button-secondary min-h-11 px-4"
                type="submit"
                disabled={busy || starters.length !== 11}
              >
                {busy ? messages.loading : messages.preview}
              </button>
            </form>
          </details>
        </div>
      )}

      {preview ? (
        <section
          className="card grid gap-4 p-5"
          aria-labelledby="lineup-preview"
        >
          <h2 id="lineup-preview" className="score-font text-xl">
            {messages.previewTitle}
          </h2>
          <p>
            {messages.previewCounts
              .replace("{creates}", String(preview.participantCreates ?? 0))
              .replace("{updates}", String(preview.participantUpdates ?? 0))
              .replace("{deletes}", String(preview.participantDeletes ?? 0))}
          </p>
          <ChangeList changes={changes} messages={messages} />
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
              <label className="grid gap-2">
                <span>{messages.confirmation}</span>
                <input
                  className="game-inset min-h-11 px-3"
                  placeholder={`prepare-verified-lineup:${action.matchId}`}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <button
                className="button-primary min-h-11 px-4"
                type="button"
                disabled={busy}
                onClick={apply}
              >
                {messages.applyLineup}
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

function ChangeList({
  changes,
  messages,
}: {
  changes: LineupChange[];
  messages: AdminMessages;
}) {
  return (
    <div className="game-inset grid gap-2 p-4 text-sm">
      <strong>{messages.currentVsProposed}</strong>
      {changes.length === 0 ? (
        <p>{messages.noDraftChanges}</p>
      ) : (
        <ul className="grid gap-2">
          {changes.map((change) => (
            <li key={change.playerId}>
              <strong>{change.playerName}</strong>:{" "}
              {displayStatus(change.before, messages)} →{" "}
              {displayStatus(change.after, messages)}
            </li>
          ))}
        </ul>
      )}
    </div>
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

function displayStatus(
  status: LineupChange["before"],
  messages: AdminMessages,
): string {
  return status ? messages.participationStatuses[status] : messages.notSelected;
}
