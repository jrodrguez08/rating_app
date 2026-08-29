import { describe, expect, it } from "vitest";

import {
  getRateableParticipants,
  isParticipantRateable,
} from "./rating-eligibility";

describe("rating eligibility", () => {
  it("includes only confirmed participants and excludes unused substitutes", () => {
    const participants = [
      {
        playerId: "starter",
        teamId: "tracked-team",
        participated: true,
      },
      {
        playerId: "entered-substitute",
        teamId: "tracked-team",
        participated: true,
      },
      {
        playerId: "unused-substitute",
        teamId: "tracked-team",
        participated: false,
      },
      {
        playerId: "opponent-starter",
        teamId: "opponent-team",
        participated: true,
      },
      {
        playerId: "opponent-substitute",
        teamId: "opponent-team",
        participated: true,
      },
    ];

    expect(
      getRateableParticipants(participants, "tracked-team").map(
        ({ playerId }) => playerId,
      ),
    ).toEqual(["starter", "entered-substitute"]);
    expect(isParticipantRateable(participants[2], "tracked-team")).toBe(false);
    expect(isParticipantRateable(participants[3], "tracked-team")).toBe(false);
  });
});
