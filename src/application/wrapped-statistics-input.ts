import { isMatchContextOwnedByTeam } from "@/application/match-identity";
import { MAX_PUBLISHED_RESULT_PLAYERS } from "@/application/published-result-podium";
import {
  evaluateWrappedCoverage,
  type WrappedScopeEvidence,
} from "@/application/wrapped-coverage";
import { parseWrappedLedger } from "@/application/wrapped-ledger";
import { coachProviderAliasId } from "@/domain/coach-identity";
import type {
  Coach,
  CoachAssignment,
  CoachProviderAlias,
  Match,
  MatchParticipant,
  MatchResult,
  Player,
  PlayerPosition,
  PlayerProviderAlias,
} from "@/domain/models";
import {
  canonicalPlayerIdMap,
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import {
  reconstructRating,
  type RatingFraction,
} from "@/domain/wrapped-rating";

type Identity = Pick<Player | Coach, "id" | "displayName">;

export interface WrappedMatchSource {
  match: Match;
  currentResult?: { summary: MatchResult; reopenCount: number };
  participants?: readonly MatchParticipant[];
  coach?: CoachAssignment;
}

export interface WrappedStatisticsEvidence {
  ledger: unknown;
  tournamentKey: string;
  scope: WrappedScopeEvidence;
  sources: readonly WrappedMatchSource[];
  asOf: Date;
  players: readonly Identity[];
  playerAliases: readonly PlayerProviderAlias[];
  coaches?: readonly Identity[];
  coachAliases?: readonly CoachProviderAlias[];
}

type ErrorCode =
  | "invalid_ledger"
  | "unknown_tournament"
  | "conflicting_source"
  | "incomplete_coverage"
  | "invalid_identity"
  | "conflicting_alias"
  | "missing_player_identity"
  | "duplicate_canonical_player"
  | "unsupported_rating_precision"
  | "conflicting_participant"
  | "invalid_policy";

export class WrappedStatisticsError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly reference?: string,
  ) {
    super(reference === undefined ? code : code + ": " + reference);
  }
}

export interface RatedAppearance extends Identity {
  rating: RatingFraction;
  ballots: number;
  position?: PlayerPosition;
  role?: "starter" | "entrant";
}

function indexIdentities(identities: readonly Identity[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const { id, displayName } of identities) {
    if (
      typeof id !== "string" ||
      !id.trim() ||
      typeof displayName !== "string" ||
      !displayName.trim() ||
      index.has(id)
    )
      throw new WrappedStatisticsError("invalid_identity", id);
    index.set(id, displayName);
  }
  return index;
}

function validateAlias(
  index: Map<string, string>,
  source: string,
  canonical: string,
  actualId: string,
  expectedId: string,
) {
  if (
    actualId !== expectedId ||
    typeof canonical !== "string" ||
    !canonical.trim() ||
    index.has(source)
  )
    throw new WrappedStatisticsError("conflicting_alias", actualId);
  index.set(source, canonical);
}

function requireDirectAliases(aliases: ReadonlyMap<string, string>) {
  for (const target of aliases.values()) {
    const next = aliases.get(target);
    if (next !== undefined && next !== target)
      throw new WrappedStatisticsError("conflicting_alias", target);
  }
}

function checkedRating(
  average: number,
  votes: number,
  matchId: string,
): RatingFraction {
  const rating = reconstructRating(average, votes);
  if (!rating)
    throw new WrappedStatisticsError("unsupported_rating_precision", matchId);
  return rating;
}

function participantRole(participant: MatchParticipant) {
  if (
    !participant.participated ||
    (participant.participationProvenance !== "operator_verified" &&
      participant.participationProvenance !== "provider")
  )
    return undefined;
  if (
    participant.squadRole === "starter" &&
    participant.starter &&
    participant.participationStatus === "confirmed_starter"
  )
    return "starter";
  if (
    participant.squadRole === "substitute" &&
    !participant.starter &&
    participant.participationStatus === "confirmed_substitute"
  )
    return "entrant";
  return undefined;
}

const positions = new Set<string>([
  "goalkeeper",
  "defender",
  "midfielder",
  "attacker",
]);

function isPosition(position: string | undefined): position is PlayerPosition {
  return position !== undefined && positions.has(position);
}

export function prepareWrappedStatistics(input: WrappedStatisticsEvidence) {
  let ledger;
  try {
    ledger = parseWrappedLedger(input.ledger);
  } catch {
    throw new WrappedStatisticsError("invalid_ledger");
  }
  const tournament = ledger.tournaments.find(
    ({ key }) => key === input.tournamentKey,
  );
  if (!tournament) throw new WrappedStatisticsError("unknown_tournament");
  const fixtureById = new Map(
    tournament.fixtures.map((fixture) => [fixture.matchId, fixture]),
  );
  const sourceById = new Map<string, WrappedMatchSource>();
  const matches = new Map<string, Match>();
  const summaries = new Map<string, MatchResult>();
  for (const source of input.sources) {
    const { match, currentResult } = source;
    const fixture = fixtureById.get(match.id);
    if (
      !fixture ||
      match.trackedTeamId !== ledger.teamId ||
      sourceById.has(match.id)
    )
      throw new WrappedStatisticsError("conflicting_source", match.id);
    sourceById.set(match.id, source);
    matches.set(match.id, match);
    if (!currentResult) continue;
    const { summary, reopenCount } = currentResult;
    if (
      fixture.disposition !== "expected" ||
      reopenCount !== (match.votingReopenCount ?? 0) ||
      summary.matchId !== match.id ||
      summary.teamId !== ledger.teamId ||
      Object.keys(summary.playerResults ?? {}).length >
        MAX_PUBLISHED_RESULT_PLAYERS
    )
      throw new WrappedStatisticsError("conflicting_source", match.id);
    summaries.set(match.id, summary);
  }

  const coverage = evaluateWrappedCoverage({
    ledger,
    tournament,
    scope: input.scope,
    matches,
    summaries,
    asOf: input.asOf,
  });
  if (!coverage.coverageComplete)
    throw new WrappedStatisticsError(
      "incomplete_coverage",
      coverage.blockers[0] ?? coverage.fixtureBlockers[0]?.code,
    );

  const playerNames = indexIdentities(input.players);
  const coachNames = indexIdentities(input.coaches ?? []);
  const playerBindings = new Map<string, string>();
  for (const alias of input.playerAliases) {
    validateAlias(
      playerBindings,
      providerEntityId(
        "player",
        alias.externalProvider,
        alias.externalProviderPlayerId,
      ),
      alias.canonicalPlayerId,
      alias.id,
      playerProviderAliasId(
        alias.externalProvider,
        alias.externalProviderPlayerId,
      ),
    );
  }
  const playerAliases = canonicalPlayerIdMap(input.playerAliases);
  requireDirectAliases(playerAliases);
  const coachAliases = new Map<string, string>();
  for (const alias of input.coachAliases ?? []) {
    validateAlias(
      coachAliases,
      providerEntityId(
        "coach",
        alias.externalProvider,
        alias.externalProviderCoachId,
      ),
      alias.canonicalCoachId,
      alias.id,
      coachProviderAliasId(
        alias.externalProvider,
        alias.externalProviderCoachId,
      ),
    );
  }
  requireDirectAliases(coachAliases);

  const references = [];
  const rated = [];
  for (const { matchId, observation } of coverage.fixtures) {
    if (observation.status !== "rated" && observation.status !== "zero_votes")
      continue;
    const source = sourceById.get(matchId)!;
    const { match, currentResult } = source;
    const { summary, reopenCount } = currentResult!;
    references.push({ matchId, generatedAt: summary.generatedAt, reopenCount });
    if (observation.status === "zero_votes") continue;
    const participants = new Map<string, MatchParticipant>();
    for (const participant of source.participants ?? []) {
      const id =
        playerAliases.get(participant.playerId) ?? participant.playerId;
      if (
        !isMatchContextOwnedByTeam(match, participant) ||
        participant.externalProviderTeamId !==
          input.scope.team?.externalProviderId ||
        participants.has(id)
      )
        throw new WrappedStatisticsError("conflicting_participant", matchId);
      participants.set(id, participant);
    }
    const players = new Map<string, RatedAppearance>();
    for (const row of Object.values(summary.playerResults)) {
      const id = playerAliases.get(row.playerId) ?? row.playerId;
      const displayName = playerNames.get(id);
      if (displayName === undefined)
        throw new WrappedStatisticsError("missing_player_identity", id);
      if (players.has(id))
        throw new WrappedStatisticsError("duplicate_canonical_player", matchId);
      const participant = participants.get(id);
      if (participant?.participationStatus === "unused_substitute")
        throw new WrappedStatisticsError("conflicting_participant", matchId);
      const role = participant && participantRole(participant);
      const position =
        role &&
        participant?.participationProvenance === "provider" &&
        isPosition(participant.position)
          ? participant.position
          : undefined;
      players.set(id, {
        id,
        displayName,
        rating: checkedRating(row.average, row.voteCount, matchId),
        ballots: row.voteCount,
        role,
        position,
      });
    }
    const coachId =
      coachAliases.get(summary.coachResult.coachId) ??
      summary.coachResult.coachId;
    const coachRating = checkedRating(
      summary.coachResult.average,
      summary.coachResult.voteCount,
      matchId,
    );
    const coach = source.coach;
    if (
      coach &&
      (!isMatchContextOwnedByTeam(match, coach) ||
        coach.externalProviderTeamId !== input.scope.team?.externalProviderId)
    )
      throw new WrappedStatisticsError("conflicting_source", matchId);
    const coachName = coachNames.get(coachId);
    const verifiedCoach: RatedAppearance | undefined =
      coach?.role === "head-coach" &&
      (coach.provenance === "provider" ||
        coach.provenance === "operator_verified") &&
      (coachAliases.get(coach.coachId) ?? coach.coachId) === coachId &&
      coachName !== undefined
        ? {
            id: coachId,
            displayName: coachName,
            rating: coachRating,
            ballots: summary.ballotCount,
          }
        : undefined;
    rated.push({
      matchId,
      kickoffAt: match.kickoffAt,
      ballots: summary.ballotCount,
      players: [...players.values()],
      coach: verifiedCoach,
    });
  }
  return { coverage, references, rated };
}
