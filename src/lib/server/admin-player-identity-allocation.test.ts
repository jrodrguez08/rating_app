import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  issueInternalPlayerAllocationToken,
  verifyInternalPlayerAllocationToken,
} from "./admin-player-identity-allocation";

const originalConfiguration = process.env.ADMIN_PASSPHRASE_SCRYPT;
const allocation = {
  playerId: `player-internal-${"b".repeat(32)}`,
  ownerId: "owner-uid",
  matchId: "match-1",
  trackedTeamId: "team-1",
};

describe("internal Player allocation tokens", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSPHRASE_SCRYPT = "test-allocation-signing-key".repeat(
      4,
    );
  });

  afterEach(() => {
    if (originalConfiguration === undefined) {
      delete process.env.ADMIN_PASSPHRASE_SCRYPT;
    } else {
      process.env.ADMIN_PASSPHRASE_SCRYPT = originalConfiguration;
    }
  });

  it("survives draft reloads while remaining bound to the owner and match", () => {
    const token = issueInternalPlayerAllocationToken(allocation);

    expect(verifyInternalPlayerAllocationToken(token, allocation)).toBe(true);
    expect(
      verifyInternalPlayerAllocationToken(token, {
        ...allocation,
        ownerId: "different-owner",
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
});
