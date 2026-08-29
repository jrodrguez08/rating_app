import { describe, expect, it } from "vitest";

import {
  getRateableParticipants,
  isParticipantRateable,
} from "./rating-eligibility";

describe("rating eligibility", () => {
  it("includes only confirmed participants and excludes unused substitutes", () => {
    const participants = [
      { playerId: "starter", participated: true },
      { playerId: "entered-substitute", participated: true },
      { playerId: "unused-substitute", participated: false },
    ];

    expect(
      getRateableParticipants(participants).map(({ playerId }) => playerId),
    ).toEqual(["starter", "entered-substitute"]);
    expect(isParticipantRateable(participants[2])).toBe(false);
  });
});
