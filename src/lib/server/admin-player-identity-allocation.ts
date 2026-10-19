import { createHmac, timingSafeEqual } from "node:crypto";

import { isInternalPlayerId } from "@/domain/player-identity";

export interface InternalPlayerAllocation {
  playerId: string;
  ownerId: string;
  matchId: string;
  trackedTeamId: string;
}

export function issueInternalPlayerAllocationToken(
  allocation: InternalPlayerAllocation,
): string {
  validateAllocation(allocation);
  const payload = Buffer.from(JSON.stringify(allocation)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyInternalPlayerAllocationToken(
  token: string | undefined,
  expected: InternalPlayerAllocation,
): boolean {
  if (!token || token.length > 2_048) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !safeSignature(payload, signature)) {
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

function sign(payload: string): string {
  const key = process.env.ADMIN_PASSPHRASE_SCRYPT;
  if (!key || key.length < 64) {
    throw new Error("Admin passphrase configuration is unavailable.");
  }
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeSignature(payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
