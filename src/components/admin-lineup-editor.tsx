"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";

import type { ParticipationStatus, PlayerPosition } from "@/domain/models";
import type { Messages } from "@/i18n/messages";
import type { AdminMatchDetail } from "@/lib/firebase/admin-console";
import type {
  AdminLineupAction,
  AdminLineupParticipantAction,
} from "@/lib/server/admin-lineup-action";

type AdminMessages = Messages["admin"];

interface EditableParticipant extends AdminLineupParticipantAction {
  playerName: string;
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
  const [participants, setParticipants] = useState<EditableParticipant[]>(() =>
    detail.participants.map((participant) => ({
      playerId: participant.playerId,
      playerName: participant.playerName,
      createInternalIdentity:
        participant.identityProvenance === "operator_verified" &&
        !detail.players.some((player) => player.id === participant.playerId),
      squadRole: participant.squadRole,
      participationStatus:
        participant.participationStatus ??
        (participant.squadRole === "starter"
          ? "confirmed_starter"
          : participant.participated
            ? "confirmed_substitute"
            : "unused_substitute"),
      ...(participant.shirtNumber === undefined
        ? {}
        : { shirtNumber: participant.shirtNumber }),
      ...(isPlayerPosition(participant.position)
        ? { position: participant.position }
        : {}),
      ...(participant.enteredAtMinute === undefined
        ? {}
        : { enteredAtMinute: participant.enteredAtMinute }),
    })),
  );
  const [search, setSearch] = useState("");
  const [internalId, setInternalId] = useState("");
  const [internalName, setInternalName] = useState("");
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
  const selectedIds = useMemo(
    () => new Set(participants.map(({ playerId }) => playerId)),
    [participants],
  );
  const availablePlayers = detail.players.filter(
    (player) =>
      !selectedIds.has(player.id) &&
      player.name
        .toLocaleLowerCase("es")
        .includes(search.toLocaleLowerCase("es")),
  );
  const editable = ["not_ready", "preparing_rating"].includes(
    detail.match.ratingState,
  );
  const starters = participants.filter(
    (participant) => participant.squadRole === "starter",
  );
  const substitutes = participants.filter(
    (participant) => participant.squadRole === "substitute",
  );
  const action: AdminLineupAction = {
    matchId: detail.match.id,
    trackedTeamId: teamId,
    externalFixtureId: detail.match.externalFixtureId,
    participants,
    verificationSource: evidence,
    verificationReason: reason,
  };

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

  function addPlayer(
    playerId: string,
    playerName: string,
    createInternalIdentity: boolean,
    squadRole: "starter" | "substitute",
  ) {
    if (selectedIds.has(playerId)) {
      setError(messages.duplicatePlayerError);
      return;
    }
    setParticipants((current) => [
      ...current,
      {
        playerId,
        playerName,
        createInternalIdentity,
        squadRole,
        participationStatus:
          squadRole === "starter" ? "confirmed_starter" : "unused_substitute",
      },
    ]);
    setSearch("");
    setInternalId("");
    setInternalName("");
    resetAuthorization();
  }

  function updateParticipant(
    playerId: string,
    values: Partial<EditableParticipant>,
  ) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.playerId === playerId
          ? { ...participant, ...values }
          : participant,
      ),
    );
    resetAuthorization();
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
        </div>
        <p className="text-muted text-sm">{messages.lifecycleOwnsVoting}</p>
      </section>

      {!editable ? (
        <section className="card p-5" role="status">
          {messages.historicalReadOnly}
        </section>
      ) : (
        <form className="grid gap-6" onSubmit={createPreview}>
          <section className="card grid gap-4 p-5">
            <h2 className="score-font text-xl">{messages.playerSelection}</h2>
            <label className="grid gap-2">
              <span>{messages.searchPlayers}</span>
              <input
                className="game-inset min-h-11 px-3"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {search ? (
              <ul className="game-inset grid max-h-64 gap-2 overflow-auto p-3">
                {availablePlayers.length === 0 ? (
                  <li className="text-muted text-sm">{messages.noPlayers}</li>
                ) : (
                  availablePlayers.map((player) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--game-border)] pb-2"
                      key={player.id}
                    >
                      <span>{player.name}</span>
                      <span className="flex flex-wrap gap-2">
                        <button
                          className="button-utility min-h-11 px-3"
                          type="button"
                          onClick={() =>
                            addPlayer(player.id, player.name, false, "starter")
                          }
                        >
                          {messages.addStarter}
                        </button>
                        <button
                          className="button-utility min-h-11 px-3"
                          type="button"
                          onClick={() =>
                            addPlayer(
                              player.id,
                              player.name,
                              false,
                              "substitute",
                            )
                          }
                        >
                          {messages.addSubstitute}
                        </button>
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            <details className="game-inset p-4">
              <summary className="cursor-pointer font-bold">
                {messages.internalIdentity}
              </summary>
              <div className="mt-4 grid gap-3">
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
                <div className="flex flex-wrap gap-2">
                  <button
                    className="button-utility min-h-11 px-3"
                    type="button"
                    disabled={!internalId || !internalName}
                    onClick={() =>
                      addPlayer(internalId, internalName, true, "starter")
                    }
                  >
                    {messages.addStarter}
                  </button>
                  <button
                    className="button-utility min-h-11 px-3"
                    type="button"
                    disabled={!internalId || !internalName}
                    onClick={() =>
                      addPlayer(internalId, internalName, true, "substitute")
                    }
                  >
                    {messages.addSubstitute}
                  </button>
                </div>
              </div>
            </details>
          </section>

          <ParticipantGroup
            title={`${messages.starters} (${starters.length}/11)`}
            participants={starters}
            messages={messages}
            update={updateParticipant}
            remove={(playerId) => {
              setParticipants((current) =>
                current.filter(
                  (participant) => participant.playerId !== playerId,
                ),
              );
              resetAuthorization();
            }}
          />
          <ParticipantGroup
            title={`${messages.substitutes} (${substitutes.length})`}
            participants={substitutes}
            messages={messages}
            update={updateParticipant}
            remove={(playerId) => {
              setParticipants((current) =>
                current.filter(
                  (participant) => participant.playerId !== playerId,
                ),
              );
              resetAuthorization();
            }}
          />

          <section className="card grid gap-4 p-5">
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
            <button
              className="button-primary min-h-11 px-4"
              type="submit"
              disabled={
                busy || starters.length !== 11 || substitutes.length < 1
              }
            >
              {busy ? messages.loading : messages.preview}
            </button>
          </section>
        </form>
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
          <ul className="game-inset grid gap-1 p-4 text-sm">
            {participants.map((participant) => (
              <li key={participant.playerId}>
                {participant.playerName} ·{" "}
                {
                  messages.participationStatuses[
                    participant.participationStatus
                  ]
                }
              </li>
            ))}
          </ul>
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

function ParticipantGroup({
  title,
  participants,
  messages,
  update,
  remove,
}: {
  title: string;
  participants: EditableParticipant[];
  messages: AdminMessages;
  update: (playerId: string, values: Partial<EditableParticipant>) => void;
  remove: (playerId: string) => void;
}) {
  return (
    <section className="card grid gap-4 p-5">
      <h2 className="score-font text-xl">{title}</h2>
      {participants.length === 0 ? (
        <p className="text-muted text-sm">{messages.groupEmpty}</p>
      ) : (
        <ul className="grid gap-3">
          {participants.map((participant) => (
            <li
              className="game-inset grid gap-3 p-4"
              key={participant.playerId}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{participant.playerName}</strong>
                <button
                  className="button-utility min-h-11 px-3"
                  type="button"
                  onClick={() => remove(participant.playerId)}
                >
                  {messages.remove}
                </button>
              </div>
              <label className="grid gap-2">
                <span>{messages.role}</span>
                <select
                  className="game-inset min-h-11 px-3"
                  value={participant.squadRole}
                  onChange={(event) => {
                    const starter = event.target.value === "starter";
                    update(participant.playerId, {
                      squadRole: starter ? "starter" : "substitute",
                      participationStatus: starter
                        ? "confirmed_starter"
                        : "unused_substitute",
                      enteredAtMinute: undefined,
                    });
                  }}
                >
                  <option value="starter">{messages.starter}</option>
                  <option value="substitute">{messages.substitute}</option>
                </select>
              </label>
              {participant.squadRole === "substitute" ? (
                <>
                  <label className="grid gap-2">
                    <span>{messages.participation}</span>
                    <select
                      className="game-inset min-h-11 px-3"
                      value={participant.participationStatus}
                      onChange={(event) => {
                        const status = event.target
                          .value as ParticipationStatus;
                        update(participant.playerId, {
                          participationStatus: status,
                          ...(status === "confirmed_substitute"
                            ? {}
                            : { enteredAtMinute: undefined }),
                        });
                      }}
                    >
                      <option value="confirmed_substitute">
                        {messages.participationStatuses.confirmed_substitute}
                      </option>
                      <option value="unused_substitute">
                        {messages.participationStatuses.unused_substitute}
                      </option>
                      <option value="unconfirmed">
                        {messages.participationStatuses.unconfirmed}
                      </option>
                    </select>
                  </label>
                  {participant.participationStatus ===
                  "confirmed_substitute" ? (
                    <label className="grid gap-2">
                      <span>{messages.entryMinute}</span>
                      <input
                        className="game-inset min-h-11 px-3"
                        inputMode="numeric"
                        min={1}
                        max={130}
                        type="number"
                        value={participant.enteredAtMinute ?? ""}
                        onChange={(event) =>
                          update(participant.playerId, {
                            enteredAtMinute: event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          })
                        }
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function isPlayerPosition(value: string | undefined): value is PlayerPosition {
  return ["goalkeeper", "defender", "midfielder", "attacker"].includes(
    value ?? "",
  );
}
