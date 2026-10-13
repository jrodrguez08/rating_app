import { describe, expect, it } from "vitest";

import type { Match } from "./models";
import {
  getEffectiveVotingWindow,
  getVotingWindowState,
} from "./voting-window";

const match = {
  ratingState: "rating_ready",
  votingOpensAt: "2026-10-12T18:00:00.000Z",
  votingClosesAt: "2026-10-12T20:00:00.000Z",
} as Match;

describe("effective voting window", () => {
  it("uses the original immutable window for an ordinary match", () => {
    expect(getEffectiveVotingWindow(match)).toEqual({
      opensAt: match.votingOpensAt,
      closesAt: match.votingClosesAt,
      reopened: false,
    });
    expect(getVotingWindowState(match, new Date("2026-10-12T19:00:00Z"))).toBe(
      "active",
    );
  });

  it("uses explicit effective timestamps after an operator reopen", () => {
    const reopened = {
      ...match,
      votingReopenCount: 1,
      votingReopenedAt: "2026-10-13T18:00:00.000Z",
      effectiveVotingOpensAt: "2026-10-13T18:00:00.000Z",
      effectiveVotingClosesAt: "2026-10-13T20:00:00.000Z",
    };
    expect(getEffectiveVotingWindow(reopened)).toMatchObject({
      opensAt: "2026-10-13T18:00:00.000Z",
      closesAt: "2026-10-13T20:00:00.000Z",
      reopened: true,
    });
    expect(
      getVotingWindowState(reopened, new Date("2026-10-12T19:00:00Z")),
    ).toBe("not_open");
    expect(
      getVotingWindowState(reopened, new Date("2026-10-13T20:00:00Z")),
    ).toBe("closed");
  });
});
