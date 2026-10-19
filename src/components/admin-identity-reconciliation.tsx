"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import type { Messages } from "@/i18n/messages";

import { AdminCoachIdentityReconciliation } from "./admin-coach-identity";
import { AdminPlayerIdentityReconciliation } from "./admin-player-identity";

type IdentityKind = "players" | "coaches";

export function AdminIdentityReconciliation({
  messages,
  teamId,
  teamName,
}: {
  messages: Messages["admin"];
  teamId: string;
  teamName: string;
}) {
  const [selected, setSelected] = useState<IdentityKind>("players");
  const playersTab = useRef<HTMLButtonElement>(null);
  const coachesTab = useRef<HTMLButtonElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowRight" || event.key === "End"
        ? "coaches"
        : event.key === "ArrowLeft" || event.key === "Home"
          ? "players"
          : undefined;
    if (!next) return;
    event.preventDefault();
    setSelected(next);
    (next === "players" ? playersTab : coachesTab).current?.focus();
  }

  return (
    <div className="grid gap-5">
      <div
        className="card flex flex-wrap gap-2 p-2"
        role="tablist"
        aria-label={messages.identityReconciliationTitle}
        onKeyDown={onKeyDown}
      >
        <button
          ref={playersTab}
          className={
            selected === "players"
              ? "button-primary px-4"
              : "button-utility px-4"
          }
          type="button"
          role="tab"
          id="players-tab"
          aria-controls="players-panel"
          aria-selected={selected === "players"}
          tabIndex={selected === "players" ? 0 : -1}
          onClick={() => setSelected("players")}
        >
          {messages.identityPlayersTab}
        </button>
        <button
          ref={coachesTab}
          className={
            selected === "coaches"
              ? "button-primary px-4"
              : "button-utility px-4"
          }
          type="button"
          role="tab"
          id="coaches-tab"
          aria-controls="coaches-panel"
          aria-selected={selected === "coaches"}
          tabIndex={selected === "coaches" ? 0 : -1}
          onClick={() => setSelected("coaches")}
        >
          {messages.identityCoachesTab}
        </button>
      </div>
      <div
        id="players-panel"
        role="tabpanel"
        aria-labelledby="players-tab"
        hidden={selected !== "players"}
      >
        {selected === "players" ? (
          <AdminPlayerIdentityReconciliation
            messages={messages}
            teamId={teamId}
            teamName={teamName}
          />
        ) : null}
      </div>
      <div
        id="coaches-panel"
        role="tabpanel"
        aria-labelledby="coaches-tab"
        hidden={selected !== "coaches"}
      >
        {selected === "coaches" ? (
          <AdminCoachIdentityReconciliation
            messages={messages}
            teamName={teamName}
          />
        ) : null}
      </div>
    </div>
  );
}
