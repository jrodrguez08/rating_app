import { createHash } from "node:crypto";

import type { PlayerPosition } from "@/domain/models";

export interface AdminCatalogImportAction {
  trackedTeamId: string;
  externalTeamId: string;
  observedAt: string;
  providerRequests: number;
  fixtures: Array<{
    id: string;
    kickoffAt: string;
    competitionName: string;
    lineupStatus: "missing" | "partial" | "available";
    excludedPlayerCount: number;
    coachStatus: "resolved" | "coach-missing" | "ambiguous-coach";
  }>;
  players: Array<{
    id: string;
    externalId: string;
    observedExternalIds: string[];
    name: string;
    position?: PlayerPosition;
    sourceFixtureIds: string[];
  }>;
  coaches: Array<{
    id: string;
    externalId: string;
    observedExternalIds: string[];
    name: string;
    photoUrl?: string;
    sourceFixtureIds: string[];
  }>;
  stateHash: string;
}

export function hashAdminCatalogAction(
  action: AdminCatalogImportAction,
): string {
  return createHash("sha256").update(JSON.stringify(action)).digest("hex");
}

export function adminCatalogAuditId(challengeId: string): string {
  return `catalog-import-${challengeId}`;
}

export function parseAdminCatalogAction(
  value: unknown,
): AdminCatalogImportAction {
  if (
    !isRecord(value) ||
    !validId(value.trackedTeamId) ||
    !/^\d{1,12}$/.test(String(value.externalTeamId)) ||
    !validDate(value.observedAt) ||
    !Number.isInteger(value.providerRequests) ||
    Number(value.providerRequests) < 1 ||
    Number(value.providerRequests) > 7 ||
    !/^[a-f0-9]{64}$/.test(String(value.stateHash)) ||
    !Array.isArray(value.fixtures) ||
    value.fixtures.length > 5 ||
    !Array.isArray(value.players) ||
    value.players.length > 100 ||
    !Array.isArray(value.coaches) ||
    value.coaches.length > 10
  ) {
    throw new Error("El plan de catálogo no es válido.");
  }
  const fixtures = value.fixtures.map((item: unknown) => {
    if (
      !isRecord(item) ||
      !numericId(item.id) ||
      !validDate(item.kickoffAt) ||
      !validName(item.competitionName) ||
      !["missing", "partial", "available"].includes(
        String(item.lineupStatus),
      ) ||
      !Number.isInteger(item.excludedPlayerCount) ||
      Number(item.excludedPlayerCount) < 0 ||
      Number(item.excludedPlayerCount) > 60 ||
      !["resolved", "coach-missing", "ambiguous-coach"].includes(
        String(item.coachStatus),
      )
    ) {
      throw new Error("La fuente del catálogo no es válida.");
    }
    return item as unknown as AdminCatalogImportAction["fixtures"][number];
  });
  const sourceIds = new Set(fixtures.map((fixture) => fixture.id));
  const people = <T extends "players" | "coaches">(kind: T) =>
    (value[kind] as unknown[]).map((item: unknown) => {
      if (
        !isRecord(item) ||
        !validId(item.id) ||
        !numericId(item.externalId) ||
        !Array.isArray(item.observedExternalIds) ||
        item.observedExternalIds.length < 1 ||
        item.observedExternalIds.length > 5 ||
        item.observedExternalIds.some((id: unknown) => !numericId(id)) ||
        !validName(item.name) ||
        !Array.isArray(item.sourceFixtureIds) ||
        item.sourceFixtureIds.length < 1 ||
        item.sourceFixtureIds.length > 5 ||
        item.sourceFixtureIds.some(
          (id: unknown) => typeof id !== "string" || !sourceIds.has(id),
        )
      ) {
        throw new Error("Una identidad del catálogo no es válida.");
      }
      return item;
    });
  const players = people("players").map((item) => {
    if (
      item.position !== undefined &&
      !["goalkeeper", "defender", "midfielder", "attacker"].includes(
        String(item.position),
      )
    ) {
      throw new Error("La posición del jugador no es válida.");
    }
    return item as unknown as AdminCatalogImportAction["players"][number];
  });
  const coaches = people("coaches").map((item) => {
    if (
      item.photoUrl !== undefined &&
      (typeof item.photoUrl !== "string" || item.photoUrl.length > 500)
    ) {
      throw new Error("La foto del director técnico no es válida.");
    }
    return item as unknown as AdminCatalogImportAction["coaches"][number];
  });
  if (
    new Set(players.map((person) => person.id)).size !== players.length ||
    new Set(coaches.map((person) => person.id)).size !== coaches.length ||
    new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length
  ) {
    throw new Error("El plan contiene identidades duplicadas.");
  }
  return {
    trackedTeamId: value.trackedTeamId as string,
    externalTeamId: value.externalTeamId as string,
    observedAt: value.observedAt as string,
    providerRequests: value.providerRequests as number,
    fixtures,
    players,
    coaches,
    stateHash: value.stateHash as string,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function numericId(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{1,12}$/.test(value) && Number(value) > 0
  );
}
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    value.length <= 30
  );
}
function validName(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 120
  );
}
