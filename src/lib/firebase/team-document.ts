import { Timestamp } from "firebase/firestore";

import type { Team } from "@/domain/models";

export interface TeamDocument {
  displayName: string;
  shortName: string;
  countryCode: string;
  brandingKey: string;
  externalProviderId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Invalid Team document: ${field} must be a non-empty string.`,
    );
  }
  return value;
}

function requireTimestamp(
  data: Record<string, unknown>,
  field: string,
): Timestamp {
  const value = data[field];
  if (!(value instanceof Timestamp)) {
    throw new Error(`Invalid Team document: ${field} must be a Timestamp.`);
  }
  return value;
}

export function teamFromDocument(id: string, value: unknown): Team {
  if (!isRecord(value)) {
    throw new Error("Invalid Team document: expected an object.");
  }

  const externalProviderId = value.externalProviderId;
  if (
    externalProviderId !== undefined &&
    (typeof externalProviderId !== "string" || externalProviderId.trim() === "")
  ) {
    throw new Error(
      "Invalid Team document: externalProviderId must be a non-empty string when present.",
    );
  }

  return {
    id,
    displayName: requireString(value, "displayName"),
    shortName: requireString(value, "shortName"),
    countryCode: requireString(value, "countryCode"),
    brandingKey: requireString(value, "brandingKey"),
    ...(externalProviderId === undefined ? {} : { externalProviderId }),
    createdAt: requireTimestamp(value, "createdAt").toDate().toISOString(),
    updatedAt: requireTimestamp(value, "updatedAt").toDate().toISOString(),
  };
}

export function teamToDocument(team: Team): TeamDocument {
  return {
    displayName: team.displayName,
    shortName: team.shortName,
    countryCode: team.countryCode,
    brandingKey: team.brandingKey,
    ...(team.externalProviderId === undefined
      ? {}
      : { externalProviderId: team.externalProviderId }),
    createdAt: Timestamp.fromDate(new Date(team.createdAt)),
    updatedAt: Timestamp.fromDate(new Date(team.updatedAt)),
  };
}
