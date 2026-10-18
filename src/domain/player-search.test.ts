import { describe, expect, it } from "vitest";

import { normalizePlayerSearch, playerSearchPrefixes } from "./player-search";

describe("player search normalization", () => {
  it("normalizes accents, case, punctuation, and whitespace", () => {
    expect(normalizePlayerSearch("  JosÉ-Pablo   SalVATIERRA ")).toBe(
      "jose pablo salvatierra",
    );
  });

  it("indexes full-name and individual-word prefixes", () => {
    const prefixes = playerSearchPrefixes("Elías Aguilar");

    expect(prefixes).toContain("elias a");
    expect(prefixes).toContain("agui");
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes.length).toBeLessThanOrEqual(160);
  });
});
