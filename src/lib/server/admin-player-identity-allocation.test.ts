import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InternalPlayerIdentityConfigurationError } from "./admin-lineup-error";
import {
  issueInternalPlayerAllocationToken,
  verifyInternalPlayerAllocationToken,
} from "./admin-player-identity-allocation";

const variableNames = [
  "ADMIN_PLAYER_IDENTITY_SIGNING_KEY",
  "ADMIN_PLAYER_IDENTITY_PREVIOUS_SIGNING_KEY",
  "ADMIN_PLAYER_IDENTITY_PREVIOUS_KEY_UNTIL",
  "ADMIN_PLAYER_IDENTITY_LEGACY_SIGNING_KEY",
  "ADMIN_PLAYER_IDENTITY_LEGACY_UNTIL",
] as const;
const originalConfiguration = Object.fromEntries(
  variableNames.map((name) => [name, process.env[name]]),
);
const currentKey = "current-allocation-signing-key".repeat(2);
const allocation = {
  playerId: `player-internal-${"b".repeat(32)}`,
  ownerId: "owner-uid",
  matchId: "match-1",
  trackedTeamId: "team-1",
};

describe("internal Player allocation tokens", () => {
  beforeEach(() => {
    for (const name of variableNames) delete process.env[name];
    process.env.ADMIN_PLAYER_IDENTITY_SIGNING_KEY = currentKey;
  });

  afterEach(() => {
    for (const name of variableNames) {
      const value = originalConfiguration[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("survives draft reloads while remaining bound to the owner and match", () => {
    const token = issueInternalPlayerAllocationToken(allocation);

    expect(token.startsWith("v2.")).toBe(true);
    expect(verifyInternalPlayerAllocationToken(token, allocation)).toBe(true);
    expect(
      verifyInternalPlayerAllocationToken(token, {
        ...allocation,
        ownerId: "different-owner",
      }),
    ).toBe(false);
    expect(
      verifyInternalPlayerAllocationToken(token, {
        ...allocation,
        matchId: "different-match",
      }),
    ).toBe(false);
    expect(
      verifyInternalPlayerAllocationToken(token, {
        ...allocation,
        trackedTeamId: "different-team",
      }),
    ).toBe(false);
  });

  it("rejects tampering and a different allocated ID", () => {
    const token = issueInternalPlayerAllocationToken(allocation);

    expect(verifyInternalPlayerAllocationToken(`${token}x`, allocation)).toBe(
      false,
    );
    expect(
      verifyInternalPlayerAllocationToken(token, {
        ...allocation,
        playerId: `player-internal-${"c".repeat(32)}`,
      }),
    ).toBe(false);
  });

  it("accepts a previous v2 key only during its configured window", () => {
    const token = issueInternalPlayerAllocationToken(allocation);
    process.env.ADMIN_PLAYER_IDENTITY_SIGNING_KEY = "replacement-key".repeat(3);
    process.env.ADMIN_PLAYER_IDENTITY_PREVIOUS_SIGNING_KEY = currentKey;
    process.env.ADMIN_PLAYER_IDENTITY_PREVIOUS_KEY_UNTIL = new Date(
      Date.now() + 60_000,
    ).toISOString();

    expect(verifyInternalPlayerAllocationToken(token, allocation)).toBe(true);
    process.env.ADMIN_PLAYER_IDENTITY_PREVIOUS_KEY_UNTIL = new Date(
      Date.now() - 1,
    ).toISOString();
    expect(verifyInternalPlayerAllocationToken(token, allocation)).toBe(false);
  });

  it("accepts legacy tokens only with the explicit bounded migration key", () => {
    const legacyKey = "legacy-passphrase-digest".repeat(2);
    const payload = Buffer.from(JSON.stringify(allocation)).toString(
      "base64url",
    );
    const token = `${payload}.${createHmac("sha256", legacyKey)
      .update(payload)
      .digest("base64url")}`;
    process.env.ADMIN_PLAYER_IDENTITY_LEGACY_SIGNING_KEY = legacyKey;
    process.env.ADMIN_PLAYER_IDENTITY_LEGACY_UNTIL = new Date(
      Date.now() + 60_000,
    ).toISOString();

    expect(verifyInternalPlayerAllocationToken(token, allocation)).toBe(true);
    delete process.env.ADMIN_PLAYER_IDENTITY_LEGACY_SIGNING_KEY;
    delete process.env.ADMIN_PLAYER_IDENTITY_LEGACY_UNTIL;
    expect(verifyInternalPlayerAllocationToken(token, allocation)).toBe(false);
  });

  it("fails closed when signing or rotation configuration is incomplete", () => {
    delete process.env.ADMIN_PLAYER_IDENTITY_SIGNING_KEY;
    expect(() => issueInternalPlayerAllocationToken(allocation)).toThrow(
      InternalPlayerIdentityConfigurationError,
    );

    process.env.ADMIN_PLAYER_IDENTITY_SIGNING_KEY = currentKey;
    process.env.ADMIN_PLAYER_IDENTITY_PREVIOUS_SIGNING_KEY = "old-key".repeat(
      8,
    );
    const token = issueInternalPlayerAllocationToken(allocation);
    expect(() =>
      verifyInternalPlayerAllocationToken(token, allocation),
    ).toThrow(InternalPlayerIdentityConfigurationError);
  });
});
