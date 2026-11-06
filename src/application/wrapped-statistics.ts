import {
  prepareWrappedStatistics,
  WrappedStatisticsError,
  type RatedAppearance,
  type WrappedStatisticsEvidence,
} from "@/application/wrapped-statistics-input";
import {
  compareRatings,
  meanRating,
  serializeRating,
  type RatingFraction,
} from "@/domain/wrapped-rating";

export const WRAPPED_PILOT_POLICY = Object.freeze({
  version: "wrapped-pilot-v1",
  minimumRatedMatches: 3,
  minimumTotalBallots: 30,
  minimumMatchBallots: 10,
  minimumAppearances: 3,
  minimumTrendMatchesPerPeriod: 3,
} as const);

export interface WrappedStatisticalPolicy {
  readonly version: typeof WRAPPED_PILOT_POLICY.version;
  readonly minimumRatedMatches: number;
  readonly minimumTotalBallots: number;
  readonly minimumMatchBallots: number;
  readonly minimumAppearances: number;
  readonly minimumTrendMatchesPerPeriod: number;
}

export type WrappedStatisticsInput = WrappedStatisticsEvidence & {
  policy: WrappedStatisticalPolicy;
};

type OmissionReason =
  | "insufficient_tournament_sample"
  | "no_qualifying_matches"
  | "insufficient_appearances"
  | "insufficient_trend_periods"
  | "missing_position_evidence"
  | "insufficient_formation"
  | "missing_participation_evidence"
  | "missing_coach_evidence";

const omitted = (reason: OmissionReason) => ({
  status: "omitted" as const,
  reason,
});
const awarded = <T>(value: T) => ({ status: "eligible" as const, value });

interface Rank {
  rating: RatingFraction;
  appearances: number;
  ballots: number;
}

function textOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareAppearanceRank(a: Rank, b: Rank): number {
  return compareRatings(b.rating, a.rating) || b.appearances - a.appearances;
}

function compareMatchRank(a: Rank, b: Rank): number {
  return compareRatings(b.rating, a.rating) || b.ballots - a.ballots;
}

function coLeaders<T>(ranked: readonly T[], compare: (a: T, b: T) => number) {
  return ranked.filter((entry) => compare(entry, ranked[0]) === 0);
}

function groupAppearances(rows: readonly RatedAppearance[]) {
  const groups = new Map<string, RatedAppearance[]>();
  for (const row of rows) {
    const group = groups.get(row.id);
    if (group) group.push(row);
    else groups.set(row.id, [row]);
  }
  return [...groups.values()];
}

function rankGroups(groups: readonly RatedAppearance[][], minimum: number) {
  return groups
    .filter((rows) => rows.length >= minimum)
    .map((rows) => ({
      id: rows[0].id,
      displayName: rows[0].displayName,
      rating: meanRating(rows.map(({ rating }) => rating)),
      appearances: rows.length,
      ballots: rows.reduce((total, row) => total + row.ballots, 0),
    }))
    .sort((a, b) => compareAppearanceRank(a, b) || textOrder(a.id, b.id));
}

function serializeRank<T extends Rank>(rank: T) {
  return { ...rank, rating: serializeRating(rank.rating) };
}

function appearanceAward(
  groups: readonly RatedAppearance[][],
  minimum: number,
) {
  const ranked = rankGroups(groups, minimum);
  return ranked.length
    ? awarded({
        minimumAppearances: minimum,
        winners: coLeaders(ranked, compareAppearanceRank).map(serializeRank),
      })
    : omitted("insufficient_appearances");
}

const formation = [
  ["goalkeeper", 1],
  ["defender", 4],
  ["midfielder", 3],
  ["attacker", 3],
] as const;

function bestXI(
  groups: readonly RatedAppearance[][],
  minimum: number,
  positionMinimum: number,
) {
  if (!groups.some((rows) => rows.some((row) => row.position)))
    return omitted("missing_position_evidence");
  const slots = [];
  for (const [position, count] of formation) {
    const candidates = groups
      .filter((rows) => rows.length >= minimum)
      .map((rows) => {
        const inPosition = rows.filter((row) => row.position === position);
        return inPosition.length > rows.length / 2 ? inPosition : [];
      });
    const ranked = rankGroups(candidates, positionMinimum);
    if (ranked.length < count) return omitted("insufficient_formation");
    slots.push({
      position,
      players: ranked.slice(0, count).map(serializeRank),
      tiedAlternates: ranked
        .slice(count)
        .filter(
          (candidate) =>
            compareAppearanceRank(candidate, ranked[count - 1]) === 0,
        )
        .map(serializeRank),
    });
  }
  return awarded({
    formation: "4-3-3" as const,
    minimumAppearances: minimum,
    minimumPositionAppearances: positionMinimum,
    slots,
  });
}

export function calculateWrappedStatistics(input: WrappedStatisticsInput) {
  const policy = {
    version: input.policy.version,
    minimumRatedMatches: input.policy.minimumRatedMatches,
    minimumTotalBallots: input.policy.minimumTotalBallots,
    minimumMatchBallots: input.policy.minimumMatchBallots,
    minimumAppearances: input.policy.minimumAppearances,
    minimumTrendMatchesPerPeriod: input.policy.minimumTrendMatchesPerPeriod,
  };
  if (
    policy.version !== WRAPPED_PILOT_POLICY.version ||
    [
      policy.minimumRatedMatches,
      policy.minimumTotalBallots,
      policy.minimumMatchBallots,
      policy.minimumAppearances,
      policy.minimumTrendMatchesPerPeriod,
    ].some((value) => !Number.isSafeInteger(value) || value < 1)
  )
    throw new WrappedStatisticsError("invalid_policy");

  const { coverage, references, rated } = prepareWrappedStatistics(input);
  const ballots = rated.map((match) => match.ballots).sort((a, b) => a - b);
  const midpoint = Math.floor(ballots.length / 2);
  const overview = {
    ratedMatches: coverage.counts.rated,
    validBallots: coverage.counts.totalValidBallots,
    distinctRatedPlayers: new Set(
      rated.flatMap(({ players }) => players.map(({ id }) => id)),
    ).size,
    medianBallots:
      ballots.length === 0
        ? null
        : ballots.length % 2
          ? ballots[midpoint]
          : ballots[midpoint - 1] +
            (ballots[midpoint] - ballots[midpoint - 1]) / 2,
  };
  const meetsCoreSample =
    overview.ratedMatches >= policy.minimumRatedMatches &&
    overview.validBallots >= policy.minimumTotalBallots;
  const qualifying = rated
    .filter((match) => match.ballots >= policy.minimumMatchBallots)
    .sort(
      (a, b) =>
        Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt) ||
        textOrder(a.matchId, b.matchId),
    );
  const minimum = Math.max(
    policy.minimumAppearances,
    Math.ceil(qualifying.length / 2),
  );
  const eligibility = {
    meetsCoreSample,
    qualifyingMatches: qualifying.length,
    minimumTournamentAppearances: minimum,
  };
  const tournament = coverage.tournament;
  const base = {
    publicationStatus: "candidate_only" as const,
    clubSlug: coverage.clubSlug,
    teamId: coverage.teamId,
    tournament: {
      key: tournament.key,
      competitionId: tournament.competitionId,
      provider: tournament.provider,
      providerCompetitionId: tournament.providerCompetitionId,
      seasonId: tournament.seasonId,
      providerSeason: tournament.providerSeason,
      seasonStartYear: tournament.seasonStartYear,
      seasonEndYear: tournament.seasonEndYear,
      edition: tournament.edition,
      editionYear: tournament.editionYear,
      stages: tournament.stages,
      completedAt: tournament.completion?.completedAt,
    },
    asOf: coverage.asOf,
    policy: {
      ...policy,
      status: "provisional" as const,
      weighting: "equal_match" as const,
    },
    references,
    coverage: { ...coverage.counts, complete: coverage.coverageComplete },
    eligibility,
    overview,
  };
  if (!meetsCoreSample || qualifying.length === 0) {
    const reason = !meetsCoreSample
      ? "insufficient_tournament_sample"
      : "no_qualifying_matches";
    return {
      ...base,
      awards: {
        playerOfTournament: omitted(reason),
        bestIndividualMatch: omitted(reason),
        highestRatedMatch: omitted(reason),
        trend: omitted(reason),
        bestXI: omitted(reason),
        bestSubstitute: omitted(reason),
        coachOfTournament: omitted(reason),
      },
    };
  }

  const players = qualifying
    .flatMap((match) =>
      [...match.players]
        .sort((a, b) => textOrder(a.id, b.id))
        .map(({ id, displayName, rating, ballots }) => ({
          id,
          displayName,
          rating,
          ballots,
          matchId: match.matchId,
          appearances: 1,
        })),
    )
    .sort(compareMatchRank);
  const matches = qualifying.map(({ matchId, ballots, players }) => ({
    matchId,
    ballots,
    appearances: 1,
    rating: meanRating(players.map(({ rating }) => rating)),
  }));
  const orderedMatches = [...matches].sort(compareMatchRank);
  const groupRows = qualifying.flatMap((match) => match.players);
  const groups = groupAppearances(groupRows);
  const coaches = qualifying.flatMap(({ coach }) => (coach ? [coach] : []));
  const half = Math.floor(matches.length / 2);
  const period = (entries: typeof matches) => ({
    matchIds: entries.map(({ matchId }) => matchId),
    rating: serializeRating(meanRating(entries.map(({ rating }) => rating))),
  });

  return {
    ...base,
    awards: {
      playerOfTournament: appearanceAward(groups, minimum),
      bestIndividualMatch: awarded({
        winners: coLeaders(players, compareMatchRank).map(serializeRank),
      }),
      highestRatedMatch: awarded({
        winners: coLeaders(orderedMatches, compareMatchRank).map(serializeRank),
      }),
      trend:
        half < policy.minimumTrendMatchesPerPeriod
          ? omitted("insufficient_trend_periods")
          : awarded({
              measure: "supporter_rating" as const,
              matchesPerPeriod: half,
              earlier: period(matches.slice(0, half)),
              later: period(matches.slice(-half)),
            }),
      bestXI: bestXI(groups, minimum, policy.minimumAppearances),
      bestSubstitute: groupRows.some(({ role }) => role === undefined)
        ? omitted("missing_participation_evidence")
        : appearanceAward(
            groupAppearances(
              groupRows.filter(({ role }) => role === "entrant"),
            ),
            policy.minimumAppearances,
          ),
      coachOfTournament:
        coaches.length < qualifying.length
          ? omitted("missing_coach_evidence")
          : appearanceAward(groupAppearances(coaches), minimum),
    },
  };
}

export type WrappedStatisticsCandidate = ReturnType<
  typeof calculateWrappedStatistics
>;
