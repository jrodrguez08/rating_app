import { describe, expect, it } from "vitest";

import { providerEntityId } from "@/domain/player-identity";

import { proposedPlayerProviderAlias } from "./player-identity-reconciliations";

const timestamp = "2026-09-07T12:00:00.000Z";

const reconciliations = [
  ["S. Rodriguez", "541314", "36237", "player-f020ba4cf4c187bcedb2255d"],
  ["E. Bravo", "669618", "404115", "player-497ecbd4e8df4c3996e95570"],
  ["K. Estrada", "628817", "512850", "player-86124cff51a0d24f11270789"],
] as const;

describe("player identity reconciliations", () => {
  it.each(reconciliations)(
    "maps the confirmed %s provider IDs to one canonical Player",
    (_name, legacyId, canonicalId, expectedPlayerId) => {
      expect(providerEntityId("player", "api-football", canonicalId)).toBe(
        expectedPlayerId,
      );
      const derivedPlayerId = providerEntityId(
        "player",
        "api-football",
        canonicalId,
      );
      for (const externalPlayerId of [canonicalId, legacyId]) {
        expect(
          proposedPlayerProviderAlias(
            "api-football",
            externalPlayerId,
            timestamp,
          ),
        ).toMatchObject({
          canonicalPlayerId: derivedPlayerId,
          canonicalExternalProviderPlayerId: canonicalId,
          externalProviderPlayerId: externalPlayerId,
        });
      }
    },
  );

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
