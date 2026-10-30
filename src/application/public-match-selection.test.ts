import { describe, expect, it } from "vitest";

import type { Match } from "@/domain/models";

import { selectPublicMatch } from "./public-match-selection";

const NOW = new Date("2026-10-30T14:00:00.000Z");

describe("public match selection", () => {
  it("selects an upcoming fixture over a historical live closed match", () => {
    const stale = match({
      id: "stale-live-closed",
      status: "live",
      ratingState: "rating_closed",
      kickoffAt: "2026-10-24T02:00:00.000Z",
      score: { home: 1, away: 0 },
      votingOpensAt: "2026-10-30T13:00:00.000Z",
      votingClosesAt: "2026-10-30T15:00:00.000Z",
    });
    const upcoming = match({
      id: "upcoming",
      kickoffAt: "2026-11-01T23:00:00.000Z",
    });

    expect(selectPublicMatch([stale, upcoming], NOW)?.id).toBe("upcoming");
  });

  it("gives an active voting window precedence over an upcoming fixture", () => {
    const active = match({
      id: "active",
      status: "finished",
      ratingState: "rating_ready",
      kickoffAt: "2026-10-30T08:00:00.000Z",
      votingOpensAt: "2026-10-30T13:00:00.000Z",
      votingClosesAt: "2026-10-30T15:00:00.000Z",
    });
    const upcoming = match({
      id: "upcoming",
      kickoffAt: "2026-11-01T23:00:00.000Z",
    });

    expect(selectPublicMatch([upcoming, active], NOW)?.id).toBe("active");
  });

  it("uses the effective reopened window instead of the original close", () => {
    const reopened = match({
      id: "reopened",
      status: "finished",
      ratingState: "rating_ready",
      kickoffAt: "2026-10-29T02:00:00.000Z",
      votingOpensAt: "2026-10-29T04:00:00.000Z",
      votingClosesAt: "2026-10-29T06:00:00.000Z",
      votingReopenCount: 1,
      effectiveVotingOpensAt: "2026-10-30T13:30:00.000Z",
      effectiveVotingClosesAt: "2026-10-30T15:30:00.000Z",
    });
    const upcoming = match({
      id: "upcoming",
      kickoffAt: "2026-11-01T23:00:00.000Z",
    });

    expect(selectPublicMatch([upcoming, reopened], NOW)?.id).toBe("reopened");
  });

  it("selects a genuinely current live fixture before a future fixture", () => {
    const live = match({
      id: "live",
      status: "live",
      kickoffAt: "2026-10-30T13:00:00.000Z",
      score: { home: 1, away: 0 },
    });
    const upcoming = match({
      id: "upcoming",
      kickoffAt: "2026-11-01T23:00:00.000Z",
    });

    expect(selectPublicMatch([upcoming, live], NOW)?.id).toBe("live");
  });

  it("does not let a live status outside the four-hour window displace an upcoming fixture", () => {
    const stale = match({
      id: "stale-live",
      status: "live",
      kickoffAt: "2026-10-30T09:59:59.999Z",
    });
    const upcoming = match({
      id: "upcoming",
      kickoffAt: "2026-11-01T23:00:00.000Z",
    });

    expect(selectPublicMatch([stale, upcoming], NOW)?.id).toBe("upcoming");
  });

  it("sorts multiple scheduled fixtures by absolute kickoff time", () => {
    const later = match({
      id: "later",
      kickoffAt: "2026-11-02T00:30:00.000Z",
    });
    const next = match({
      id: "next",
      kickoffAt: "2026-11-01T05:30:00.000Z",
    });

    expect(selectPublicMatch([later, next], NOW)?.id).toBe("next");
  });

  it("uses absolute instants across the Costa Rica date boundary", () => {
    const costaRicaNow = new Date("2026-10-31T05:59:59.000Z");
    const afterLocalMidnight = match({
      id: "after-local-midnight",
      kickoffAt: "2026-10-31T06:30:00.000Z",
    });
    const later = match({
      id: "later",
      kickoffAt: "2026-10-31T23:00:00.000Z",
    });

    expect(
      selectPublicMatch([later, afterLocalMidnight], costaRicaNow)?.id,
    ).toBe("after-local-midnight");
  });

  it("falls back to the most recent completed match when no future fixture exists", () => {
    const older = match({
      id: "older",
      status: "finished",
      kickoffAt: "2026-10-20T02:00:00.000Z",
    });
    const recent = match({
      id: "recent",
      status: "live",
      ratingState: "rating_closed",
      kickoffAt: "2026-10-24T02:00:00.000Z",
    });

    expect(selectPublicMatch([recent, older], NOW)?.id).toBe("recent");
  });

  it("returns no match when there is neither current, upcoming, nor completed evidence", () => {
    const staleUnfinished = match({
      status: "live",
      kickoffAt: "2026-10-20T02:00:00.000Z",
    });

    expect(selectPublicMatch([staleUnfinished], NOW)).toBeUndefined();
  });
});

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: "match",
    trackedTeamId: "club-sport-herediano",
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "CS Herediano" },
    awayTeam: { externalProviderId: "820", name: "Opponent" },
    kickoffAt: "2026-11-01T23:00:00.000Z",
    status: "scheduled",
    ratingState: "not_ready",
    score: { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: "fixture",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}
