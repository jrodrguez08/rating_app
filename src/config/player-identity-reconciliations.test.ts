import { describe, expect, it } from "vitest";

import { providerEntityId } from "@/domain/player-identity";

import { proposedPlayerProviderAlias } from "./player-identity-reconciliations";

const timestamp = "2026-09-07T12:00:00.000Z";

describe("player identity reconciliations", () => {
  it("maps both confirmed Rodriguez provider IDs to the richer canonical Player", () => {
    const aliases = ["36237", "541314"].map((externalPlayerId) =>
      proposedPlayerProviderAlias("api-football", externalPlayerId, timestamp),
    );
    expect(aliases.map(({ canonicalPlayerId }) => canonicalPlayerId)).toEqual([
      providerEntityId("player", "api-football", "36237"),
      providerEntityId("player", "api-football", "36237"),
    ]);
  });

  it("keeps unknown provider IDs distinct without name or shirt heuristics", () => {
    const first = proposedPlayerProviderAlias(
      "api-football",
      "unknown-1",
      timestamp,
    );
    const second = proposedPlayerProviderAlias(
      "api-football",
      "unknown-2",
      timestamp,
    );
    expect(first.canonicalPlayerId).not.toBe(second.canonicalPlayerId);
  });
});
