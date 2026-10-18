"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";

import type { PlayerPosition } from "@/domain/models";
import type { Messages } from "@/i18n/messages";
import type { AdminPlayerOption } from "@/lib/firebase/admin-console";

import {
  laneFor,
  type EditableParticipant,
  type LineupLane,
} from "./admin-lineup-draft";
import { PlayerAvatar } from "./player-avatar";

type AdminMessages = Messages["admin"];

export function RosterResult({
  player,
  messages,
  starterDisabled,
  add,
}: {
  player: AdminPlayerOption;
  messages: AdminMessages;
  starterDisabled: boolean;
  add: (player: AdminPlayerOption, lane: LineupLane) => void;
}) {
  return (
    <li className="grid gap-3 border-b border-[var(--game-border)] pb-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
      <PlayerAvatar
        name={player.name}
        photoUrl={player.photoUrl}
        label={messages.playerAvatar.replace("{player}", player.name)}
      />
      <span className="min-w-0">
        <strong className="block break-words">{player.name}</strong>
        <span className="text-muted text-sm">
          {player.position
            ? messages.positions[player.position]
            : messages.metadataUnavailable}{" "}
          {player.shirtNumber === undefined ? "" : `· #${player.shirtNumber} `}·{" "}
          {messages.canonicalIdentity}
        </span>
      </span>
      <span className="flex flex-wrap gap-2 sm:justify-end">
        <button
          className="button-utility min-h-11 px-3"
          type="button"
          disabled={starterDisabled}
          onClick={() => add(player, "starters")}
        >
          {messages.addStarter}
        </button>
        <button
          className="button-utility min-h-11 px-3"
          type="button"
          onClick={() => add(player, "available")}
        >
          {messages.addSubstitute}
        </button>
      </span>
    </li>
  );
}

export function LineupGroup({
  lane,
  participants,
  metadata,
  messages,
  starterCount,
  move,
  remove,
  updateEntryMinute,
}: {
  lane: LineupLane;
  participants: EditableParticipant[];
  metadata: Map<string, AdminPlayerOption>;
  messages: AdminMessages;
  starterCount: number;
  move: (playerId: string, lane: LineupLane) => void;
  remove: (playerId: string) => void;
  updateEntryMinute: (playerId: string, minute?: number) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: lane });
  const title = lineupLaneTitle(lane, messages);
  return (
    <section
      ref={setNodeRef}
      className={`card grid content-start gap-4 p-4 ${isOver ? "outline-2 outline-offset-2 outline-[var(--game-focus)]" : ""}`}
      aria-labelledby={`lineup-${lane}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={`lineup-${lane}`} className="score-font text-lg">
          {title}
        </h2>
        <span className="status-badge">
          {lane === "starters"
            ? `${participants.length}/11`
            : participants.length}
        </span>
      </div>
      <p className="text-muted text-sm">{laneHelp(lane, messages)}</p>
      {participants.length === 0 ? (
        <p className="game-inset p-4 text-sm">{messages.groupEmpty}</p>
      ) : (
        <ul className="grid gap-3">
          {participants.map((participant) => (
            <ParticipantCard
              key={participant.playerId}
              participant={participant}
              player={metadata.get(participant.playerId)}
              messages={messages}
              starterCount={starterCount}
              move={move}
              remove={remove}
              updateEntryMinute={updateEntryMinute}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ParticipantCard({
  participant,
  player,
  messages,
  starterCount,
  move,
  remove,
  updateEntryMinute,
}: {
  participant: EditableParticipant;
  player?: AdminPlayerOption;
  messages: AdminMessages;
  starterCount: number;
  move: (playerId: string, lane: LineupLane) => void;
  remove: (playerId: string) => void;
  updateEntryMinute: (playerId: string, minute?: number) => void;
}) {
  const lane = laneFor(participant);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: participant.playerId });
  const style = transform
    ? {
        transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`,
      }
    : undefined;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`game-inset grid gap-3 p-3 ${isDragging ? "z-10 opacity-80" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <PlayerAvatar
          name={participant.playerName}
          photoUrl={player?.photoUrl}
          label={messages.playerAvatar.replace(
            "{player}",
            participant.playerName,
          )}
        />
        <span className="min-w-0 flex-1">
          <strong className="block break-words">
            {participant.playerName}
          </strong>
          <span className="text-muted block text-sm">
            {participant.shirtNumber === undefined
              ? ""
              : `#${participant.shirtNumber} · `}
            {(participant.position ?? player?.position)
              ? messages.positions[
                  (participant.position ?? player?.position) as PlayerPosition
                ]
              : messages.metadataUnavailable}
          </span>
          <span className="text-muted block text-xs">
            {participant.createInternalIdentity
              ? messages.internalCanonicalIdentity
              : messages.canonicalIdentity}{" "}
            · {detailProvenance(participant, messages)}
          </span>
        </span>
        <button
          className="button-utility min-h-11 shrink-0 px-3"
          type="button"
          aria-label={messages.dragPlayer.replace(
            "{player}",
            participant.playerName,
          )}
          {...listeners}
          {...attributes}
        >
          {messages.move}
        </button>
      </div>
      {lane === "entered" ? (
        <label className="grid gap-2 text-sm">
          <span>{messages.entryMinute}</span>
          <input
            className="game-inset min-h-11 px-3"
            inputMode="numeric"
            min={1}
            max={130}
            type="number"
            value={participant.enteredAtMinute ?? ""}
            onChange={(event) =>
              updateEntryMinute(
                participant.playerId,
                event.target.value ? Number(event.target.value) : undefined,
              )
            }
          />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {lane !== "starters" ? (
          <button
            className="button-utility min-h-11 px-3"
            type="button"
            disabled={starterCount >= 11}
            onClick={() => move(participant.playerId, "starters")}
          >
            {messages.addStarter}
          </button>
        ) : (
          <button
            className="button-utility min-h-11 px-3"
            type="button"
            onClick={() => move(participant.playerId, "available")}
          >
            {messages.moveToSubstitutes}
          </button>
        )}
        {lane !== "entered" && lane !== "starters" ? (
          <button
            className="button-utility min-h-11 px-3"
            type="button"
            onClick={() => move(participant.playerId, "entered")}
          >
            {messages.markEntered}
          </button>
        ) : null}
        {lane === "entered" ? (
          <button
            className="button-utility min-h-11 px-3"
            type="button"
            onClick={() => move(participant.playerId, "available")}
          >
            {messages.markNotEntered}
          </button>
        ) : null}
        {lane === "available" ? (
          <button
            className="button-utility min-h-11 px-3"
            type="button"
            onClick={() => move(participant.playerId, "unconfirmed")}
          >
            {messages.markUnconfirmed}
          </button>
        ) : null}
        {lane === "unconfirmed" ? (
          <button
            className="button-utility min-h-11 px-3"
            type="button"
            onClick={() => move(participant.playerId, "available")}
          >
            {messages.markNotEntered}
          </button>
        ) : null}
        <button
          className="button-utility min-h-11 px-3"
          type="button"
          onClick={() => remove(participant.playerId)}
        >
          {messages.removeFromPreparation}
        </button>
      </div>
    </li>
  );
}

export function lineupLaneTitle(lane: string, messages: AdminMessages): string {
  if (lane === "starters") return messages.starters;
  if (lane === "available") return messages.availableSubstitutes;
  if (lane === "entered") return messages.enteredSubstitutes;
  return messages.unconfirmedParticipation;
}

function laneHelp(lane: LineupLane, messages: AdminMessages): string {
  if (lane === "starters") return messages.startersHelp;
  if (lane === "available") return messages.availableSubstitutesHelp;
  if (lane === "entered") return messages.enteredSubstitutesHelp;
  return messages.unconfirmedParticipationHelp;
}

function detailProvenance(
  participant: EditableParticipant,
  messages: AdminMessages,
): string {
  return participant.createInternalIdentity
    ? messages.internalIdentityEvidence
    : participant.evidenceProvenance === "draft"
      ? messages.savedDraftEvidence
      : participant.evidenceProvenance === "operator_verified"
        ? messages.provenance.operator_verified
        : messages.provenance.provider;
}
