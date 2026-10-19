import { createHmac, timingSafeEqual } from "node:crypto";

import { isInternalPlayerId } from "@/domain/player-identity";

import { InternalPlayerIdentityConfigurationError } from "./admin-lineup-error";

export interface InternalPlayerAllocation {
  playerId: string;
  ownerId: string;
  matchId: string;
  trackedTeamId: string;
}

const CURRENT_TOKEN_VERSION = "v2";
const MINIMUM_SIGNING_KEY_LENGTH = 32;

export function issueInternalPlayerAllocationToken(
  allocation: InternalPlayerAllocation,
): string {
  validateAllocation(allocation);
  const payload = Buffer.from(JSON.stringify(allocation)).toString("base64url");
  return `${CURRENT_TOKEN_VERSION}.${payload}.${sign(payload, currentKey())}`;
}

export function verifyInternalPlayerAllocationToken(
  token: string | undefined,
  expected: InternalPlayerAllocation,
): boolean {
  if (!token || token.length > 2_048) return false;
  const parts = token.split(".");
  let payload: string;
  let signature: string;
  let validSignature: boolean;
  if (parts.length === 3 && parts[0] === CURRENT_TOKEN_VERSION) {
    [, payload, signature] = parts;
    validSignature = verificationKeys().some((key) =>
      safeSignature(payload, signature, key),
    );
  } else if (parts.length === 2) {
    [payload, signature] = parts;
    const legacyKey = boundedKey(
      "ADMIN_PLAYER_IDENTITY_LEGACY_SIGNING_KEY",
      "ADMIN_PLAYER_IDENTITY_LEGACY_UNTIL",
    );
    validSignature =
      legacyKey !== null && safeSignature(payload, signature, legacyKey);
  } else {
    return false;
  }
  if (!payload || !signature || !validSignature) {
    return false;
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  return (
    isAllocation(value) &&
    value.playerId === expected.playerId &&
    value.ownerId === expected.ownerId &&
    value.matchId === expected.matchId &&
    value.trackedTeamId === expected.trackedTeamId
  );
}

function validateAllocation(value: InternalPlayerAllocation): void {
  if (!isAllocation(value))
    throw new Error("Internal Player allocation is invalid.");
}

function isAllocation(value: unknown): value is InternalPlayerAllocation {
  return (
    typeof value === "object" &&
    value !== null &&
    "playerId" in value &&
    typeof value.playerId === "string" &&
    isInternalPlayerId(value.playerId) &&
    "ownerId" in value &&
    typeof value.ownerId === "string" &&
    /^[A-Za-z0-9_.@:-]{1,128}$/.test(value.ownerId) &&
    "matchId" in value &&
    typeof value.matchId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value.matchId) &&
    "trackedTeamId" in value &&
    typeof value.trackedTeamId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value.trackedTeamId)
  );
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeSignature(
  payload: string,
  signature: string,
  key: string,
): boolean {
  const expected = Buffer.from(sign(payload, key));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function currentKey(): string {
  return requiredKey("ADMIN_PLAYER_IDENTITY_SIGNING_KEY");
}

function verificationKeys(): string[] {
  const keys = [currentKey()];
  const previous = boundedKey(
    "ADMIN_PLAYER_IDENTITY_PREVIOUS_SIGNING_KEY",
    "ADMIN_PLAYER_IDENTITY_PREVIOUS_KEY_UNTIL",
  );
  if (previous !== null) keys.push(previous);
  return keys;
}

function requiredKey(name: string): string {
  const value = process.env[name];
  if (!value || value.length < MINIMUM_SIGNING_KEY_LENGTH) {
    throw new InternalPlayerIdentityConfigurationError();
  }
  return value;
}

function boundedKey(keyName: string, untilName: string): string | null {
  const key = process.env[keyName];
  const until = process.env[untilName];
  if (key === undefined && until === undefined) return null;
  if (!key || key.length < MINIMUM_SIGNING_KEY_LENGTH || !until) {
    throw new InternalPlayerIdentityConfigurationError();
  }
  const expiresAt = Date.parse(until);
  if (!Number.isFinite(expiresAt)) {
    throw new InternalPlayerIdentityConfigurationError();
  }
  return expiresAt > Date.now() ? key : null;
}
