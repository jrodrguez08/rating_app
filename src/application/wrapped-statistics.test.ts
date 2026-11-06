import { describe, expect, it } from "vitest";

import { parseWrappedLedger } from "@/application/wrapped-ledger";
import type { WrappedMatchSource } from "@/application/wrapped-statistics-input";
import {
  calculateWrappedStatistics,
  WRAPPED_PILOT_POLICY,
} from "@/application/wrapped-statistics";
import type { ClubSlug } from "@/config/club";
import type { MatchParticipant, PlayerProviderAlias } from "@/domain/models";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";

import {
  asOf,
  competition,
  ledgerInput,
  provider,
  season,
  wrappedFixture,
  wrappedMatch,
  wrappedSummary,
  wrappedTeam,
} from "../../tests/wrapped-fixtures";

function fixture(
  club: ClubSlug,
  number: number,
  ballots = 12,
  ratings = { player: 8 } as Record<string, number>,
): WrappedMatchSource & {
  currentResult: NonNullable<WrappedMatchSource["currentResult"]>;
} {
  const day = String(number + 2).padStart(2, "0");
  const match = wrappedMatch(club, String(number), {
    kickoffAt: `2025-06-${day}T18:00:00.000Z`,
    votingOpensAt: `2025-06-${day}T20:00:00.000Z`,
    votingClosesAt: `2025-06-${day}T22:00:00.000Z`,
  });
  const summary = {
    ...wrappedSummary(match, ballots),
    generatedAt: match.votingClosesAt!,
    playerResults: Object.fromEntries(
      Object.entries(ratings).map(([id, average], order) => [
        id,
        {
          playerId: id,
          playerName: id,
          average: ballots ? average : 0,
          voteCount: ballots,
          order,
        },
      ]),
    ),
    mvpPlayerIds: ballots
      ? Object.keys(ratings).filter(
          (id) => ratings[id] === Math.max(...Object.values(ratings)),
        )
      : [],
  };
  return { match, currentResult: { summary, reopenCount: 0 } };
}

function evidence(
  club: ClubSlug,
  sources: readonly WrappedMatchSource[],
  ids = ["player"],
  edition: "clausura" | "apertura" = "clausura",
) {
  const ledger = ledgerInput(
    club,
    sources.map(({ match }) => wrappedFixture(match)),
    { edition },
  );
  return {
    ledger,
    tournamentKey: parseWrappedLedger(ledger).tournaments[0].key,
    scope: { team: wrappedTeam(club), competition, season },
    sources,
    asOf,
    players: ids.map((id) => ({ id, displayName: "Canonical " + id })),
    playerAliases: [] as PlayerProviderAlias[],
    policy: WRAPPED_PILOT_POLICY,
  };
}

function participant(
  { match }: WrappedMatchSource,
  id: string,
  changes: Partial<MatchParticipant> = {},
): MatchParticipant {
  return {
    matchId: match.id,
    teamId: match.trackedTeamId,
    externalProviderTeamId: match.trackedTeamExternalProviderId!,
    playerId: id,
    playerName: id,
    squadRole: "starter",
    starter: true,
    participated: true,
    participationStatus: "confirmed_starter",
    participationProvenance: "provider",
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
    ...changes,
  };
}

const ratio = (n: number, d = 1) => ({
  numerator: String(n),
  denominator: String(d),
});

describe("Wrapped statistics", () => {
  it("separates both clubs for the same provider fixtures and editions within a provider season", () => {
    const her = [0, 1, 2].map((i) =>
      fixture("herediano", i, 12, { player: 8 }),
    );
    const sap = [0, 1, 2].map((i) => fixture("saprissa", i, 20, { player: 9 }));
    const a = evidence("herediano", her);
    const b = evidence("saprissa", sap);
    const later = evidence(
      "herediano",
      [3, 4, 5].map((i) => fixture("herediano", i)),
      ["player"],
      "apertura",
    );
    a.ledger.tournaments.push(later.ledger.tournaments[0]);
    expect(calculateWrappedStatistics(a)).toMatchObject({
      clubSlug: "herediano",
      overview: { validBallots: 36 },
      tournament: { edition: "clausura" },
    });
    expect(calculateWrappedStatistics(b)).toMatchObject({
      clubSlug: "saprissa",
      overview: { validBallots: 60 },
    });
    expect(her[0].match.id).not.toBe(sap[0].match.id);
    expect(
      calculateWrappedStatistics({ ...later, ledger: a.ledger }).tournament
        .edition,
    ).toBe("apertura");
    expect(() => calculateWrappedStatistics({ ...a, sources: sap })).toThrow(
      /conflicting_source/,
    );
    expect(() =>
      calculateWrappedStatistics({ ...a, sources: later.sources }),
    ).toThrow(/conflicting_source/);
    her[0].currentResult.summary.teamId = sap[0].match.trackedTeamId;
    expect(() => calculateWrappedStatistics(a)).toThrow(/conflicting_source/);
  });

  it("revalidates missing, invalidated, reopened, incompatible and conflicting sources", () => {
    const source = fixture("herediano", 0);
    const input = evidence("herediano", [source]);
    expect(() => calculateWrappedStatistics({ ...input, sources: [] })).toThrow(
      /incomplete_coverage/,
    );
    expect(() =>
      calculateWrappedStatistics({ ...input, sources: [source, source] }),
    ).toThrow(/conflicting_source/);
    expect(() =>
      calculateWrappedStatistics({
        ...input,
        sources: [
          {
            ...source,
            match: {
              ...source.match,
              ratingState: "rating_ready",
              votingReopenCount: 1,
            },
            currentResult: undefined,
          },
        ],
      }),
    ).toThrow(/reopened/);
    expect(() =>
      calculateWrappedStatistics({
        ...input,
        sources: [{ ...source, currentResult: undefined }],
      }),
    ).toThrow(/summary_missing/);
    source.match.votingReopenCount = 1;
    expect(() => calculateWrappedStatistics(input)).toThrow(
      /conflicting_source/,
    );
    source.match.votingReopenCount = 0;
    source.currentResult.summary.playerResults.player.average = Number.NaN;
    expect(() => calculateWrappedStatistics(input)).toThrow(
      /summary_incompatible/,
    );
    source.currentResult.summary.playerResults.player.average = 8.123;
    expect(() => calculateWrappedStatistics(input)).toThrow(
      /unsupported_rating_precision/,
    );
  });

  it("reports both coverage denominators and counts rated low-sample fixtures but excludes zero-vote results from the median", () => {
    const input = evidence(
      "saprissa",
      [0, 5, 9, 15].map((ballots, i) => fixture("saprissa", i, ballots)),
    );
    const report = calculateWrappedStatistics(input);
    expect(report).toMatchObject({
      publicationStatus: "candidate_only",
      coverage: {
        complete: true,
        expectedFixtures: 4,
        completedInScope: 4,
        zeroVotes: 1,
      },
      overview: {
        ratedMatches: 3,
        validBallots: 29,
        distinctRatedPlayers: 1,
        medianBallots: 9,
      },
      eligibility: { meetsCoreSample: false, qualifyingMatches: 1 },
      awards: {
        bestIndividualMatch: {
          status: "omitted",
          reason: "insufficient_tournament_sample",
        },
      },
    });
    expect(report.references).toHaveLength(4);
    expect(
      calculateWrappedStatistics({
        ...input,
        policy: { ...input.policy, minimumTotalBallots: 29 },
      }).eligibility.meetsCoreSample,
    ).toBe(true);
    expect(() =>
      calculateWrappedStatistics({
        ...input,
        policy: { ...input.policy, minimumMatchBallots: 0 },
      }),
    ).toThrow(/invalid_policy/);
  });

  it("uses exact equal-Match weights, qualifying appearances and independent Match comparisons", () => {
    const source = [
      fixture("herediano", 0, 10, { a: 10, b: 6.5, cameo: 10 }),
      fixture("herediano", 1, 100, { a: 4, b: 6.5 }),
      fixture("herediano", 2, 10, { a: 7, b: 6.5 }),
      fixture("herediano", 3, 9, { a: 1, b: 10 }),
    ];
    const report = calculateWrappedStatistics(
      evidence("herediano", source, ["a", "b", "cameo"]),
    );
    expect(report.awards.playerOfTournament).toEqual({
      status: "eligible",
      value: {
        minimumAppearances: 3,
        winners: [
          {
            id: "a",
            displayName: "Canonical a",
            rating: ratio(7),
            appearances: 3,
            ballots: 120,
          },
        ],
      },
    });
    expect(report.awards.bestIndividualMatch).toMatchObject({
      value: {
        winners: [
          { id: "a", matchId: source[0].match.id, rating: ratio(10) },
          { id: "cameo", matchId: source[0].match.id, rating: ratio(10) },
        ],
      },
    });
    expect(report.awards.highestRatedMatch).toMatchObject({
      value: {
        winners: [{ matchId: source[0].match.id, rating: ratio(53, 6) }],
      },
    });
  });

  it("resolves reviewed aliases, preserves exact co-winners and rejects missing or duplicate identities", () => {
    const aliasId = providerEntityId("player", provider, "2");
    const sources = [0, 1, 2].map((i) =>
      fixture("herediano", i, 12, {
        [i ? "a" : aliasId]: 101 / 12,
        b: 101 / 12,
      }),
    );
    const input = evidence("herediano", sources, ["a", "b"]);
    expect(() => calculateWrappedStatistics(input)).toThrow(
      /missing_player_identity/,
    );
    input.playerAliases.push({
      id: playerProviderAliasId(provider, "2"),
      externalProvider: provider,
      externalProviderPlayerId: "2",
      canonicalPlayerId: "a",
      canonicalExternalProviderPlayerId: "1",
      createdAt: asOf.toISOString(),
      updatedAt: asOf.toISOString(),
    });
    const report = calculateWrappedStatistics(input);
    expect(report.awards.playerOfTournament).toMatchObject({
      value: {
        winners: [
          { id: "a", rating: ratio(101, 12) },
          { id: "b", rating: ratio(101, 12) },
        ],
      },
    });
    expect(() =>
      calculateWrappedStatistics({
        ...input,
        playerAliases: [
          ...input.playerAliases,
          { ...input.playerAliases[0], canonicalPlayerId: "b" },
        ],
      }),
    ).toThrow(/conflicting_alias/);
    expect(() =>
      calculateWrappedStatistics({
        ...input,
        players: [...input.players, input.players[0]],
      }),
    ).toThrow(/invalid_identity/);
    const summary = sources[0].currentResult.summary;
    summary.playerResults.a = {
      ...summary.playerResults[aliasId],
      playerId: "a",
      order: 2,
    };
    summary.mvpPlayerIds.push("a");
    expect(() => calculateWrappedStatistics(input)).toThrow(
      /duplicate_canonical_player/,
    );
  });

  it("uses chronological trend halves, skips the odd middle, and applies the half-tournament appearance floor", () => {
    const sources = [5, 6, 7, 10, 8, 9, 10].map((rating, i) =>
      fixture(
        "saprissa",
        i,
        10,
        i < 3 ? { player: rating, cameo: 10 } : { player: rating },
      ),
    );
    const input = evidence("saprissa", sources, ["player", "cameo"]);
    const report = calculateWrappedStatistics(input);
    expect(report.eligibility.minimumTournamentAppearances).toBe(4);
    expect(report.awards.playerOfTournament).toMatchObject({
      value: { winners: [{ id: "player" }] },
    });
    expect(report.awards.trend).toMatchObject({
      value: {
        measure: "supporter_rating",
        matchesPerPeriod: 3,
        earlier: {
          rating: ratio(8),
          matchIds: sources.slice(0, 3).map(({ match }) => match.id),
        },
        later: {
          rating: ratio(9),
          matchIds: sources.slice(-3).map(({ match }) => match.id),
        },
      },
    });
    const reversed = evidence(
      "saprissa",
      [...sources].reverse().map((source) => ({
        ...source,
        currentResult: {
          ...source.currentResult,
          summary: {
            ...source.currentResult.summary,
            playerResults: Object.fromEntries(
              Object.entries(
                source.currentResult.summary.playerResults,
              ).reverse(),
            ),
          },
        },
      })),
      ["cameo", "player"],
    );
    expect(calculateWrappedStatistics(reversed)).toEqual(report);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("forms a verified XI with stable tied alternatives and omits missing or incomplete formations", () => {
    const families = [
      "goalkeeper",
      ...Array<string>(5).fill("defender"),
      ...Array<string>(3).fill("midfielder"),
      ...Array<string>(3).fill("attacker"),
    ];
    const ids = families.map((_, i) => String(i).padStart(2, "0"));
    const sources = [0, 1, 2].map((i) =>
      fixture("herediano", i, 12, Object.fromEntries(ids.map((id) => [id, 8]))),
    );
    const input = evidence("herediano", sources, ids);
    expect(calculateWrappedStatistics(input).awards.bestXI).toEqual({
      status: "omitted",
      reason: "missing_position_evidence",
    });
    for (const source of sources)
      source.participants = ids.map((id, i) =>
        participant(source, id, { position: families[i] }),
      );
    expect(calculateWrappedStatistics(input).awards.bestXI).toMatchObject({
      value: {
        formation: "4-3-3",
        slots: [
          { position: "goalkeeper" },
          {
            position: "defender",
            players: ["01", "02", "03", "04"].map((id) => ({ id })),
            tiedAlternates: [{ id: "05" }],
          },
          { position: "midfielder" },
          { position: "attacker" },
        ],
      },
    });
    sources[0].participants = sources[0].participants?.map((row) =>
      row.playerId === "00"
        ? { ...row, participationProvenance: "operator_verified" }
        : row,
    );
    expect(calculateWrappedStatistics(input).awards.bestXI).toEqual({
      status: "omitted",
      reason: "insufficient_formation",
    });
  });

  it("counts confirmed entrances independently of starts and separates fixture-specific coach changes", () => {
    const sources = [0, 1, 2, 3, 4, 5].map((i) =>
      fixture("saprissa", i, 10, { player: i < 3 ? 6 : 10 }),
    );
    for (const [i, source] of sources.entries()) {
      const { match } = source;
      const coachId = i < 3 ? "coach-a" : "coach-b";
      source.currentResult.summary.coachResult.coachId = coachId;
      source.coach = {
        matchId: match.id,
        teamId: match.trackedTeamId,
        externalProviderTeamId: match.trackedTeamExternalProviderId!,
        role: "head-coach",
        coachId,
        coachName: coachId,
        provenance: "provider",
        createdAt: match.createdAt,
        updatedAt: match.updatedAt,
      };
      source.participants = [
        participant(
          source,
          "player",
          i < 3
            ? {
                squadRole: "substitute",
                starter: false,
                participationStatus: "confirmed_substitute",
              }
            : {},
        ),
        participant(source, "bench", {
          squadRole: "substitute",
          starter: false,
          participated: false,
          participationStatus: "unused_substitute",
        }),
      ];
    }
    const input = {
      ...evidence("saprissa", sources),
      coaches: ["coach-a", "coach-b"].map((id) => ({ id, displayName: id })),
    };
    expect(calculateWrappedStatistics(input).awards).toMatchObject({
      bestSubstitute: {
        value: {
          winners: [{ id: "player", appearances: 3, rating: ratio(6) }],
        },
      },
      coachOfTournament: {
        value: {
          winners: [
            { id: "coach-a", appearances: 3 },
            { id: "coach-b", appearances: 3 },
          ],
        },
      },
    });
    sources[0].coach = undefined;
    sources[0].participants = undefined;
    expect(calculateWrappedStatistics(input).awards).toMatchObject({
      bestSubstitute: {
        status: "omitted",
        reason: "missing_participation_evidence",
      },
      coachOfTournament: {
        status: "omitted",
        reason: "missing_coach_evidence",
      },
    });
  });
});
