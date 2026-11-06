import { describe, expect, it } from "vitest";

import { evaluateWrappedCoverage } from "@/application/wrapped-coverage";
import {
  MAX_WRAPPED_FIXTURES,
  parseWrappedLedger,
} from "@/application/wrapped-ledger";
import type { Match, MatchResult } from "@/domain/models";

import {
  asOf,
  competition,
  ledgerInput,
  season,
  wrappedFixture,
  wrappedMatch,
  wrappedSummary,
  wrappedTeam,
} from "../../tests/wrapped-fixtures";

function report(
  input: ReturnType<typeof ledgerInput>,
  matches: Match[],
  summaries: MatchResult[],
  now = asOf,
) {
  const ledger = parseWrappedLedger(input);
  return evaluateWrappedCoverage({
    ledger,
    tournament: ledger.tournaments[0],
    asOf: now,
    scope: { team: wrappedTeam(input.clubSlug), competition, season },
    matches: new Map(matches.map((match) => [match.id, match])),
    summaries: new Map(summaries.map((summary) => [summary.matchId, summary])),
  });
}

describe("Wrapped tournament ledger", () => {
  it("keeps Apertura and Clausura separate within the same provider season and rejects overlap", () => {
    const first = wrappedMatch("herediano", "1");
    const second = wrappedMatch("herediano", "2");
    const input = ledgerInput("herediano", [wrappedFixture(first)]);
    const other = ledgerInput("herediano", [wrappedFixture(second)], {
      edition: "apertura",
    });
    input.tournaments.push(other.tournaments[0]);
    expect(parseWrappedLedger(input).tournaments.map(({ key }) => key)).toEqual(
      ["wrapped-league:2025:clausura", "wrapped-league:2025:apertura"],
    );
    input.tournaments[1].fixtures = [wrappedFixture(first)];
    expect(() => parseWrappedLedger(input)).toThrow(/assigned more than once/);
    input.tournaments[1] = input.tournaments[0];
    expect(() => parseWrappedLedger(input)).toThrow(/duplicate competition/);
  });

  it("rejects wrong club or Match identity, unknown stage/disposition and oversized input", () => {
    const fixture = wrappedFixture(wrappedMatch("saprissa", "1"));
    expect(() =>
      parseWrappedLedger(ledgerInput("herediano", [fixture])),
    ).toThrow(/tracked Team/);
    const input = ledgerInput("saprissa", [fixture]);
    expect(() =>
      parseWrappedLedger({ ...input, teamId: "other-team" }),
    ).toThrow(/registered club/);
    expect(() =>
      parseWrappedLedger(
        ledgerInput("saprissa", [{ ...fixture, stage: "unknown" }]),
      ),
    ).toThrow(/approved scope/);
    expect(() =>
      parseWrappedLedger(
        ledgerInput("saprissa", [{ ...fixture, disposition: "assumed" }]),
      ),
    ).toThrow(/unknown fixture disposition/);
    expect(() =>
      parseWrappedLedger(
        ledgerInput("saprissa", Array(MAX_WRAPPED_FIXTURES + 1).fill(fixture)),
      ),
    ).toThrow(/1 to 512/);
  });

  it("rejects replacement loops and multiple predecessors", () => {
    const [a, b, c] = ["1", "2", "3"].map((id) =>
      wrappedFixture(wrappedMatch("herediano", id)),
    );
    const replace = (source: typeof a, target: typeof a) => ({
      ...source,
      disposition: "replaced",
      replacementMatchId: target.matchId,
      reason: "Reviewed replacement",
    });
    expect(() =>
      parseWrappedLedger(
        ledgerInput("herediano", [replace(a, b), replace(b, a)]),
      ),
    ).toThrow(/unique expected Match/);
    expect(() =>
      parseWrappedLedger(
        ledgerInput("herediano", [replace(a, b), b, replace(c, b)]),
      ),
    ).toThrow(/unique expected Match/);
  });
});

describe("Wrapped coverage report", () => {
  it("counts rated and zero-vote Matches, excludes reviewed dispositions, and has stable output", () => {
    const rated = wrappedMatch("herediano", "1");
    const zero = wrappedMatch("herediano", "2");
    const cancelled = wrappedMatch("herediano", "3", {
      status: "cancelled",
      ratingState: "not_ready",
      votingOpensAt: undefined,
    });
    const old = wrappedMatch("herediano", "4", {
      status: "postponed",
      ratingState: "not_ready",
      votingOpensAt: undefined,
    });
    const outside = wrappedMatch("herediano", "5");
    const entries = [
      wrappedFixture(rated),
      wrappedFixture(zero),
      {
        ...wrappedFixture(cancelled),
        disposition: "cancelled",
        reason: "Reviewed cancellation",
      },
      {
        ...wrappedFixture(old),
        disposition: "replaced",
        reason: "Reviewed replacement",
        replacementMatchId: rated.id,
      },
      {
        ...wrappedFixture(outside),
        disposition: "excluded",
        reason: "Predates the pilot",
      },
    ];
    const matches = [rated, zero, old, cancelled];
    const summaries = [wrappedSummary(rated), wrappedSummary(zero, 0)];
    const result = report(
      ledgerInput("herediano", entries),
      matches,
      summaries,
    );
    expect(result.coverageComplete).toBe(true);
    expect(result.counts).toEqual({
      ledgerEntries: 5,
      expectedFixtures: 2,
      completedInScope: 2,
      rated: 1,
      zeroVotes: 1,
      totalValidBallots: 12,
      ratedCoveragePercent: 50,
      excluded: 1,
      cancelled: 1,
      replaced: 1,
    });
    expect(result).toEqual(
      report(
        ledgerInput("herediano", entries.reverse()),
        matches.reverse(),
        summaries.reverse(),
      ),
    );
  });

  it("reports missing, postponed, cancelled, unfinished, active, reopened and unfinalized outcomes", () => {
    const missing = wrappedMatch("saprissa", "1");
    const postponed = wrappedMatch("saprissa", "2", { status: "postponed" });
    const cancelled = wrappedMatch("saprissa", "3", { status: "cancelled" });
    const unfinished = wrappedMatch("saprissa", "4", { status: "live" });
    const active = wrappedMatch("saprissa", "5", {
      ratingState: "rating_ready",
      votingClosesAt: "2025-07-01T00:01:00.000Z",
    });
    const reopened = wrappedMatch("saprissa", "6", {
      ratingState: "rating_ready",
      votingReopenCount: 1,
    });
    const pending = wrappedMatch("saprissa", "7", {
      ratingState: "rating_ready",
    });
    const closed = wrappedMatch("saprissa", "8");
    const matches = [
      postponed,
      cancelled,
      unfinished,
      active,
      reopened,
      pending,
      closed,
    ];
    const result = report(
      ledgerInput("saprissa", [missing, ...matches].map(wrappedFixture)),
      matches,
      [wrappedSummary(active)],
    );
    expect(result.coverageComplete).toBe(false);
    expect(
      Object.fromEntries(
        result.fixtureBlockers.map(({ matchId, code }) => [matchId, code]),
      ),
    ).toEqual({
      [missing.id]: "missing_match",
      [postponed.id]: "postponed",
      [cancelled.id]: "cancelled_unreviewed",
      [unfinished.id]: "unfinished",
      [active.id]: "voting_open",
      [reopened.id]: "reopened",
      [pending.id]: "pending_finalization",
      [closed.id]: "summary_missing",
    });
    expect(result.counts).toMatchObject({
      completedInScope: 4,
      rated: 0,
      totalValidBallots: 0,
    });
  });

  it("rejects conflicting ownership, stale or inconsistent results, and unresolved completion", () => {
    const match = wrappedMatch("saprissa", "1");
    const input = ledgerInput("saprissa", [wrappedFixture(match)], {
      completion: undefined,
    });
    const summary = wrappedSummary(match);
    expect(report(input, [match], [summary])).toMatchObject({
      coverageComplete: false,
      blockers: ["boundary_unconfirmed"],
      counts: { rated: 1 },
    });
    expect(
      report(
        input,
        [{ ...match, trackedTeamId: wrappedTeam("herediano").id }],
        [summary],
      ).fixtureBlockers,
    ).toEqual([{ matchId: match.id, code: "invalid_match" }]);
    for (const invalid of [
      { ...summary, teamId: "other" },
      { ...summary, generatedAt: "2025-06-02T21:59:59.999Z" },
      { ...summary, coachResult: { ...summary.coachResult, voteCount: 0 } },
      {
        ...wrappedSummary(match, 0),
        coachResult: { ...wrappedSummary(match, 0).coachResult, average: 1 },
      },
    ]) {
      expect(report(input, [match], [invalid]).fixtureBlockers).toEqual([
        { matchId: match.id, code: "summary_incompatible" },
      ]);
    }
    const reopened = {
      ...match,
      votingReopenCount: 1,
      votingReopenedAt: "2025-06-10T00:00:00.000Z",
      effectiveVotingOpensAt: "2025-06-10T00:00:00.000Z",
      effectiveVotingClosesAt: "2025-06-10T02:00:00.000Z",
    };
    expect(report(input, [reopened], [summary]).fixtureBlockers).toEqual([
      { matchId: match.id, code: "summary_incompatible" },
    ]);
    expect(
      report(
        input,
        [reopened],
        [{ ...summary, generatedAt: reopened.effectiveVotingClosesAt }],
      ).counts.rated,
    ).toBe(1);
  });

  it("preserves trusted early close and disallows an exclusion that conceals a rated Match", () => {
    const match = wrappedMatch("herediano", "1", {
      votingClosedEarlyAt: "2025-06-02T21:00:00.000Z",
    });
    const result = {
      ...wrappedSummary(match),
      generatedAt: match.votingClosedEarlyAt!,
    };
    expect(
      report(
        ledgerInput("herediano", [wrappedFixture(match)]),
        [match],
        [result],
      ).counts.rated,
    ).toBe(1);
    const excluded = {
      ...wrappedFixture(match),
      disposition: "excluded",
      reason: "Claimed pre-pilot",
    };
    expect(
      report(ledgerInput("herediano", [excluded]), [match], [result])
        .fixtureBlockers,
    ).toEqual([{ matchId: match.id, code: "disposition_conflict" }]);
  });
});
