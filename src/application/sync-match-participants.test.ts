import { describe, expect, it } from "vitest";

import { providerEntityId } from "./sync-match-participants";

describe("participant synchronization identities", () => {
  it("builds stable provider-mapped player and coach IDs", () => {
    expect(providerEntityId("player", "api-football", "10")).toBe(
      providerEntityId("player", "api-football", "10"),
    );
    expect(providerEntityId("player", "api-football", "10")).not.toBe(
      providerEntityId("coach", "api-football", "10"),
    );
  });
});
