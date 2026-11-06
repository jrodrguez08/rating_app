import {
  isMatchOwnedByTeam,
  trackedMatchId,
} from "@/application/match-identity";
import type {
  WrappedFixture,
  WrappedLedger,
  WrappedTournament,
} from "@/application/wrapped-ledger";
import { isCompatibleCurrentResult } from "@/domain/current-match-result";
import { hasAuthoritativeFinalWhistle } from "@/domain/manual-voting";
import type {
  Competition,
  Match,
  MatchResult,
  Season,
  Team,
} from "@/domain/models";
import { getEffectiveVotingWindow } from "@/domain/voting-window";

const statuses = new Set<Match["status"]>([
  "scheduled",
  "live",
  "finished",
  "postponed",
  "suspended",
  "cancelled",
  "abandoned",
]);
const ratingStates = new Set<Match["ratingState"]>([
  "not_ready",
  "preparing_rating",
  "rating_ready",
  "rating_closed",
]);

type Observation =
  | {
      status: "rated" | "zero_votes";
      completed: true;
      ballotCount: number;
      generatedAt: string;
    }
  | {
      status:
        | "excluded"
        | "cancelled"
        | "replaced"
        | "missing_match"
        | "scope_unverified"
        | "invalid_match"
        | "disposition_conflict"
        | "postponed"
        | "cancelled_unreviewed"
        | "unfinished"
        | "voting_open"
        | "reopened"
        | "pending_finalization"
        | "summary_missing"
        | "summary_incompatible";
      completed: boolean;
    };

export interface WrappedScopeEvidence {
  team?: Team;
  competition?: Competition;
  season?: Season;
}

export function wrappedScopeVerified(
  teamId: string,
  tournament: WrappedTournament,
  { team, competition, season }: WrappedScopeEvidence,
): boolean {
  return (
    team?.id === teamId &&
    typeof team.externalProviderId === "string" &&
    team.externalProviderId.length > 0 &&
    competition?.id === tournament.competitionId &&
    competition.type === "league" &&
    competition.externalProvider === tournament.provider &&
    competition.externalProviderId === tournament.providerCompetitionId &&
    season?.id === tournament.seasonId &&
    season.competitionId === tournament.competitionId &&
    season.externalProvider === tournament.provider &&
    season.externalProviderSeason === tournament.providerSeason
  );
}

export function observeWrappedFixture(
  fixture: WrappedFixture,
  tournament: WrappedTournament,
  team: Team,
  match: Match | undefined,
  result: MatchResult | undefined,
  asOf: Date,
): Observation {
  if (!match)
    return {
      status:
        fixture.disposition === "expected"
          ? "missing_match"
          : fixture.disposition,
      completed: false,
    };

  if (
    match.id !== fixture.matchId ||
    typeof match.homeTeam?.externalProviderId !== "string" ||
    typeof match.awayTeam?.externalProviderId !== "string" ||
    !match.homeTeam.externalProviderId ||
    !match.awayTeam.externalProviderId ||
    match.homeTeam.externalProviderId === match.awayTeam.externalProviderId ||
    !isMatchOwnedByTeam(match, team.id) ||
    (match.trackedTeamExternalProviderId !== undefined &&
      match.trackedTeamExternalProviderId !== team.externalProviderId) ||
    (match.homeTeam.externalProviderId !== team.externalProviderId &&
      match.awayTeam.externalProviderId !== team.externalProviderId) ||
    match.competitionId !== tournament.competitionId ||
    match.seasonId !== tournament.seasonId ||
    match.externalProvider !== tournament.provider ||
    typeof match.externalProviderFixtureId !== "string" ||
    !match.externalProviderFixtureId ||
    (fixture.providerFixtureId !== undefined &&
      match.externalProviderFixtureId !== fixture.providerFixtureId) ||
    trackedMatchId(
      match.externalProvider,
      match.externalProviderFixtureId,
      team.id,
    ) !== match.id ||
    !statuses.has(match.status) ||
    !ratingStates.has(match.ratingState) ||
    !Number.isFinite(Date.parse(match.kickoffAt)) ||
    (match.votingOpeningMode !== undefined &&
      match.votingOpeningMode !== "provider" &&
      match.votingOpeningMode !== "manual") ||
    (match.votingReopenCount !== undefined &&
      (!Number.isSafeInteger(match.votingReopenCount) ||
        match.votingReopenCount < 0))
  )
    return { status: "invalid_match", completed: false };

  if (fixture.disposition !== "expected") {
    const unrated =
      match.ratingState === "not_ready" &&
      match.votingOpensAt === undefined &&
      match.votingReopenedAt === undefined &&
      (match.votingReopenCount ?? 0) === 0 &&
      match.votingOpeningMode !== "manual";
    const permitted =
      fixture.disposition === "excluded" ||
      match.status === "cancelled" ||
      (fixture.disposition === "replaced" &&
        (match.status === "postponed" || match.status === "abandoned"));
    return {
      status:
        unrated && permitted ? fixture.disposition : "disposition_conflict",
      completed: false,
    };
  }

  if (match.status === "postponed")
    return { status: "postponed", completed: false };
  if (match.status === "cancelled")
    return { status: "cancelled_unreviewed", completed: false };
  const completed =
    hasAuthoritativeFinalWhistle(match) &&
    (match.status === "finished" ||
      ((match.status === "scheduled" || match.status === "live") &&
        typeof match.manualFinalWhistleAttestedAt === "string" &&
        Date.parse(match.manualFinalWhistleAttestedAt) >=
          Date.parse(match.kickoffAt) &&
        Date.parse(match.manualFinalWhistleAttestedAt) <= asOf.getTime()));
  if (!completed || Date.parse(match.kickoffAt) > asOf.getTime())
    return { status: "unfinished", completed: false };

  if (match.ratingState === "rating_ready") {
    if ((match.votingReopenCount ?? 0) > 0)
      return { status: "reopened", completed: true };
    const window = getEffectiveVotingWindow(match);
    return {
      status:
        window &&
        new Date(window.opensAt) <= asOf &&
        asOf < new Date(window.closesAt)
          ? "voting_open"
          : "pending_finalization",
      completed: true,
    };
  }
  if (match.ratingState !== "rating_closed")
    return { status: "pending_finalization", completed: true };

  const window = getEffectiveVotingWindow(match);
  if (!window) return { status: "summary_incompatible", completed: true };
  const opensAt = Date.parse(window.opensAt);
  const plannedClose = Date.parse(window.closesAt);
  const actualClose =
    match.votingClosedEarlyAt === undefined
      ? plannedClose
      : Date.parse(match.votingClosedEarlyAt);
  if (
    !Number.isFinite(actualClose) ||
    actualClose < opensAt ||
    actualClose > plannedClose ||
    actualClose > asOf.getTime() ||
    (window.reopened && Date.parse(match.votingReopenedAt ?? "") !== opensAt)
  )
    return { status: "summary_incompatible", completed: true };
  if (!result) return { status: "summary_missing", completed: true };
  if (
    !isCompatibleCurrentResult(match, result) ||
    !Number.isSafeInteger(result.ballotCount) ||
    Date.parse(result.generatedAt) < actualClose ||
    Date.parse(result.generatedAt) > asOf.getTime() ||
    !compatibleAverages(result)
  )
    return { status: "summary_incompatible", completed: true };
  return {
    status: result.status === "final" ? "rated" : "zero_votes",
    completed: true,
    ballotCount: result.ballotCount,
    generatedAt: result.generatedAt,
  };
}

function compatibleAverages(result: MatchResult): boolean {
  const players = Object.values(result.playerResults);
  if (result.status === "no_votes")
    return (
      result.coachResult.average === 0 &&
      players.every((player) => player.average === 0)
    );
  const highest = Math.max(...players.map((player) => player.average));
  const leaders = players.filter((player) => player.average === highest);
  const mvpIds = new Set(result.mvpPlayerIds);
  return (
    result.coachResult.average >= 1 &&
    players.every((player) => player.average >= 1) &&
    leaders.length === mvpIds.size &&
    leaders.every((player) => mvpIds.has(player.playerId))
  );
}

export function evaluateWrappedCoverage({
  ledger,
  tournament,
  scope,
  matches,
  summaries,
  asOf,
}: {
  ledger: WrappedLedger;
  tournament: WrappedTournament;
  scope: WrappedScopeEvidence;
  matches: ReadonlyMap<string, Match>;
  summaries: ReadonlyMap<string, MatchResult>;
  asOf: Date;
}) {
  if (!Number.isFinite(asOf.getTime()))
    throw new Error("Invalid preview time.");
  const scopeVerified = wrappedScopeVerified(ledger.teamId, tournament, scope);
  const { fixtures: inputFixtures, ...definition } = tournament;
  const fixtures = inputFixtures.map((fixture) => {
    const match = matches.get(fixture.matchId);
    const observation: Observation =
      scopeVerified && scope.team
        ? observeWrappedFixture(
            fixture,
            tournament,
            scope.team,
            match,
            summaries.get(fixture.matchId),
            asOf,
          )
        : { status: "scope_unverified", completed: false };
    return {
      ...fixture,
      matchPresence: scopeVerified
        ? match
          ? "present"
          : "missing"
        : "unchecked",
      observation,
    };
  });
  const completionTime = Date.parse(tournament.completion?.completedAt ?? "");
  const completionConflict = fixtures.some(
    ({ matchId, observation }) =>
      observation.completed &&
      Date.parse(matches.get(matchId)?.kickoffAt ?? "") > completionTime,
  );
  const boundaryConfirmed =
    Number.isFinite(completionTime) &&
    !completionConflict &&
    Date.parse(tournament.review.reviewedAt) <= asOf.getTime();
  const expectedFixtures = fixtures.filter(
    (fixture) => fixture.disposition === "expected",
  ).length;
  const completedInScope = fixtures.filter(
    ({ disposition, observation }) =>
      disposition === "expected" && observation.completed,
  ).length;
  const rated = fixtures.filter(
    ({ observation }) => observation.status === "rated",
  ).length;
  const zeroVotes = fixtures.filter(
    ({ observation }) => observation.status === "zero_votes",
  ).length;
  const totalValidBallots = fixtures.reduce(
    (total, { observation }) =>
      total + ("ballotCount" in observation ? observation.ballotCount : 0),
    0,
  );
  if (!Number.isSafeInteger(totalValidBallots))
    throw new Error("Ballot total exceeds safe integer range.");
  const fixtureBlockers = fixtures.flatMap(
    ({ matchId, observation: { status } }) =>
      status === "rated" ||
      status === "zero_votes" ||
      status === "excluded" ||
      status === "cancelled" ||
      status === "replaced"
        ? []
        : [{ matchId, code: status }],
  );
  const blockers = [
    ...(!scopeVerified ? ["scope_unverified" as const] : []),
    ...(!boundaryConfirmed ? ["boundary_unconfirmed" as const] : []),
    ...(completionConflict ? ["completion_precedes_fixture" as const] : []),
    ...(expectedFixtures === 0 ? ["no_in_scope_fixtures" as const] : []),
  ];
  return {
    clubSlug: ledger.clubSlug,
    teamId: ledger.teamId,
    tournament: definition,
    asOf: asOf.toISOString(),
    boundaryConfirmed,
    scopeVerified,
    coverageComplete: blockers.length === 0 && fixtureBlockers.length === 0,
    limitations: [
      "provided_ledger_only",
      "current_snapshot_only",
      "ballots_not_unique_supporters",
    ],
    counts: {
      ledgerEntries: fixtures.length,
      expectedFixtures,
      completedInScope,
      rated,
      zeroVotes,
      totalValidBallots,
      ratedFixtureCoveragePercent:
        expectedFixtures === 0 ? null : (rated * 100) / expectedFixtures,
      ratedCompletedFixturePercent:
        completedInScope === 0 ? null : (rated * 100) / completedInScope,
      excluded: fixtures.filter(
        ({ observation }) => observation.status === "excluded",
      ).length,
      cancelled: fixtures.filter(
        ({ observation }) => observation.status === "cancelled",
      ).length,
      replaced: fixtures.filter(
        ({ observation }) => observation.status === "replaced",
      ).length,
    },
    blockers,
    fixtureBlockers,
    fixtures,
  };
}
