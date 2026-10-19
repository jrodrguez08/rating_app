import { describe, expect, it } from "vitest";

import {
  hasAuthoritativeFinalWhistle,
  manualVotingClosesAt,
  parseCostaRicaDateTime,
} from "./manual-voting";
import type { Match } from "./models";

describe("manual voting timing", () => {
  it("uses an exact two-hour default window", () => {
    expect(
      manualVotingClosesAt(
        new Date("2026-10-20T02:15:00.000Z"),
        "default",
      ).toISOString(),
    ).toBe("2026-10-20T04:15:00.000Z");
  });

  it("converts an exact Costa Rica wall-clock time to UTC", () => {
    expect(parseCostaRicaDateTime("2026-10-19T22:30")?.toISOString()).toBe(
      "2026-10-20T04:30:00.000Z",
    );
    expect(parseCostaRicaDateTime("2026-02-30T22:30")).toBeNull();
    expect(parseCostaRicaDateTime("2026-10-19T24:00")).toBeNull();
  });

  it("rejects a custom close that is not after trusted apply time", () => {
    expect(() =>
      manualVotingClosesAt(
        new Date("2026-10-20T04:30:00.000Z"),
        "custom",
        "2026-10-19T22:30",
      ),
    ).toThrow(/invalid or expired/);
  });

  it("accepts provider full time or a persisted operator attestation", () => {
    const match = { status: "live", ratingState: "rating_ready" } as Match;
    expect(hasAuthoritativeFinalWhistle(match)).toBe(false);
    expect(
      hasAuthoritativeFinalWhistle({
        ...match,
        votingOpeningMode: "manual",
      }),
    ).toBe(true);
    expect(hasAuthoritativeFinalWhistle({ ...match, status: "finished" })).toBe(
      true,
    );
  });
});
