import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { coachProviderAliasId } from "@/domain/coach-identity";
import type {
  Coach,
  CoachAssignment,
  CoachProviderAlias,
  Match,
  MatchParticipant,
  PlayerProviderAlias,
  Team,
  VerifiedCoachAssignment,
  VerifiedLineupSnapshot,
} from "@/domain/models";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import { normalizePlayerSearch } from "@/domain/player-search";
import type {
  FootballDataProvider,
  ProviderMatchObservation,
  ProviderMatchParticipant,
} from "@/domain/ports";
import { ProviderError } from "@/lib/providers/api-football/errors";

import { getServerFirestore } from "./server";

const CHECK_COOLDOWN_MS = 60_000;

export interface AdminProviderCheckInput {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  operatorId: string;
}

export type AdminProviderCheckStatus =
  | "missing"
  | "partial"
  | "available"
  | "differences"
  | "stale"
  | "provider_error";

export interface AdminProviderCheckPerson {
  name: string;
  enteredAtMinute?: number;
  exitedAtMinute?: number;
}

export interface AdminProviderCheckSide {
  starters: AdminProviderCheckPerson[];
  participatingSubstitutes: AdminProviderCheckPerson[];
  coachName?: string;
}

export interface AdminProviderCheckDifference {
  type:
    | "missing_provider_player"
    | "unexpected_provider_player"
    | "role_mismatch"
    | "participation_mismatch"
    | "coach_mismatch";
  name: string;
}

export interface AdminProviderCheckReport {
  status: AdminProviderCheckStatus;
  checkedAt: string;
  providerRequests: number;
  providerFixtureStatus?: Match["status"];
  localEvidenceSource: "operator_verified" | "persisted_history";
  local: AdminProviderCheckSide;
  provider: AdminProviderCheckSide;
  differences: AdminProviderCheckDifference[];
  missingEvidence: Array<
    | "lineup"
    | "complete_starting_xi"
    | "substitute_participation"
    | "coach"
    | "identity_mapping"
    | "provider_final_status"
  >;
}

export class AdminProviderCheckRejectedError extends Error {
  constructor(
    public readonly code:
      | "invalid_input"
      | "match_not_found"
      | "not_finalized"
      | "binding_conflict"
      | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "AdminProviderCheckRejectedError";
  }
}

interface LocalEvidence {
  match: Match;
  source: AdminProviderCheckReport["localEvidenceSource"];
  participants: LocalParticipant[];
  coachId?: string;
  coachName?: string;
  externalTeamId: string;
}

interface LocalParticipant {
  playerId: string;
  playerName: string;
  externalProviderPlayerId?: string;
  squadRole: "starter" | "substitute";
  participated: boolean;
  participationStatus?: MatchParticipant["participationStatus"];
  enteredAtMinute?: number;
  exitedAtMinute?: number;
}

interface CanonicalProviderParticipant extends ProviderMatchParticipant {
  canonicalPlayerId: string;
  identityResolved: boolean;
}

export class AdminProviderCheckService {
  constructor(
    private readonly provider: FootballDataProvider,
    private readonly database: Firestore = getServerFirestore(),
  ) {}

  async check(
    input: AdminProviderCheckInput,
  ): Promise<AdminProviderCheckReport> {
    validateInput(input);
    const local = await this.loadLocalEvidence(input);
    const checkedAt = await this.claim(input.operatorId, input.matchId);
    if (!this.provider.inspectMatchEvidence) {
      throw new Error("The configured provider cannot inspect match evidence.");
    }
    let observation: ProviderMatchObservation;
    try {
      observation = await this.provider.inspectMatchEvidence(
        input.externalFixtureId,
        local.externalTeamId,
        local.match.kickoffAt,
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        return emptyReport(
          "provider_error",
          checkedAt,
          this.provider.requestCount,
          local,
        );
      }
      throw error;
    }
    return this.compare(local, observation, checkedAt);
  }

  private async loadLocalEvidence(
    input: AdminProviderCheckInput,
  ): Promise<LocalEvidence> {
    const matchReference = this.database.doc(`matches/${input.matchId}`);
    const [
      matchSnapshot,
      resultSnapshot,
      participantSnapshot,
      verifiedLineupSnapshot,
      assignmentSnapshot,
      verifiedCoachSnapshot,
      teamSnapshot,
    ] = await Promise.all([
      matchReference.get(),
      this.database.doc(`matches/${input.matchId}/results/summary`).get(),
      this.database.collection(`matches/${input.matchId}/participants`).get(),
      this.database
        .doc(`matches/${input.matchId}/verifiedLineups/current`)
        .get(),
      this.database
        .doc(`matches/${input.matchId}/coachAssignments/head-coach`)
        .get(),
      this.database
        .doc(`matches/${input.matchId}/verifiedCoachAssignments/head-coach`)
        .get(),
      this.database.doc(`teams/${input.trackedTeamId}`).get(),
    ]);
    if (!matchSnapshot.exists) {
      throw new AdminProviderCheckRejectedError(
        "match_not_found",
        "El partido seleccionado no existe.",
      );
    }
    const match = fromSnapshot<Match>(matchSnapshot);
    if (
      match.id !== input.matchId ||
      match.trackedTeamId !== input.trackedTeamId ||
      match.externalProvider !== "api-football" ||
      match.externalProviderFixtureId !== input.externalFixtureId
    ) {
      throw new AdminProviderCheckRejectedError(
        "binding_conflict",
        "El equipo o fixture no coincide con el partido seleccionado.",
      );
    }
    if (match.ratingState !== "rating_closed" || !resultSnapshot.exists) {
      throw new AdminProviderCheckRejectedError(
        "not_finalized",
        "La comprobación está disponible cuando los resultados ya fueron publicados.",
      );
    }
    const team = teamSnapshot.exists ? fromSnapshot<Team>(teamSnapshot) : null;
    const externalTeamId =
      match.trackedTeamExternalProviderId ?? team?.externalProviderId;
    if (
      !externalTeamId ||
      (match.homeTeam.externalProviderId !== externalTeamId &&
        match.awayTeam.externalProviderId !== externalTeamId)
    ) {
      throw new AdminProviderCheckRejectedError(
        "binding_conflict",
        "No se pudo confirmar la identidad del equipo para este fixture.",
      );
    }
    const verifiedLineup = verifiedLineupSnapshot.exists
      ? fromSnapshot<VerifiedLineupSnapshot>(verifiedLineupSnapshot)
      : undefined;
    if (
      verifiedLineup &&
      (verifiedLineup.matchId !== match.id ||
        verifiedLineup.trackedTeamId !== match.trackedTeamId ||
        verifiedLineup.externalFixtureId !== match.externalProviderFixtureId)
    ) {
      throw new AdminProviderCheckRejectedError(
        "binding_conflict",
        "La alineación verificada no corresponde al fixture seleccionado.",
      );
    }
    const participants: LocalParticipant[] = verifiedLineup
      ? verifiedLineup.participants.map((participant) => ({
          playerId: participant.playerId,
          playerName: participant.playerName,
          ...(participant.externalProviderPlayerId
            ? {
                externalProviderPlayerId: participant.externalProviderPlayerId,
              }
            : {}),
          squadRole: participant.squadRole,
          participated: participant.participated,
          participationStatus: participant.participationStatus,
          ...(participant.enteredAtMinute === undefined
            ? {}
            : { enteredAtMinute: participant.enteredAtMinute }),
        }))
      : participantSnapshot.docs
          .map((snapshot) => fromSnapshot<MatchParticipant>(snapshot))
          .filter((participant) => participant.teamId === match.trackedTeamId)
          .map((participant) => ({
            playerId: participant.playerId,
            playerName: participant.playerName,
            ...(participant.externalProviderPlayerId
              ? {
                  externalProviderPlayerId:
                    participant.externalProviderPlayerId,
                }
              : {}),
            squadRole: participant.squadRole,
            participated: participant.participated,
            ...(participant.participationStatus
              ? { participationStatus: participant.participationStatus }
              : {}),
            ...(participant.enteredAtMinute === undefined
              ? {}
              : { enteredAtMinute: participant.enteredAtMinute }),
            ...(participant.exitedAtMinute === undefined
              ? {}
              : { exitedAtMinute: participant.exitedAtMinute }),
          }));
    const verifiedCoach = verifiedCoachSnapshot.exists
      ? fromSnapshot<VerifiedCoachAssignment>(verifiedCoachSnapshot)
      : undefined;
    const assignment = assignmentSnapshot.exists
      ? fromSnapshot<CoachAssignment>(assignmentSnapshot)
      : undefined;
    const selectedCoach = verifiedCoach ?? assignment;
    let coachName = assignment?.coachName;
    if (selectedCoach) {
      const coachSnapshot = await this.database
        .doc(`coaches/${selectedCoach.coachId}`)
        .get();
      if (coachSnapshot.exists) {
        coachName = fromSnapshot<Coach>(coachSnapshot).displayName;
      }
    }
    return {
      match,
      source: verifiedLineup ? "operator_verified" : "persisted_history",
      participants,
      ...(selectedCoach ? { coachId: selectedCoach.coachId } : {}),
      ...(coachName ? { coachName } : {}),
      externalTeamId,
    };
  }

  private async claim(operatorId: string, matchId: string): Promise<string> {
    const reference = this.database.doc(`adminSecurity/${operatorId}`);
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const now = snapshot.readTime.toDate();
      const lastCheck = snapshot.data()?.providerCheckLastAt;
      if (
        lastCheck instanceof Timestamp &&
        now.getTime() - lastCheck.toMillis() < CHECK_COOLDOWN_MS
      ) {
        throw new AdminProviderCheckRejectedError(
          "rate_limited",
          "Espere un minuto antes de volver a consultar API-Football.",
        );
      }
      transaction.set(
        reference,
        {
          providerCheckLastAt: Timestamp.fromDate(now),
          providerCheckMatchId: matchId,
          updatedAt: Timestamp.fromDate(now),
        },
        { merge: true },
      );
      return now.toISOString();
    });
  }

  private async compare(
    local: LocalEvidence,
    observation: ProviderMatchObservation,
    checkedAt: string,
  ): Promise<AdminProviderCheckReport> {
    const providerParticipants = await this.canonicalizeProviderParticipants(
      observation.participants,
    );
    const localById = new Map(
      local.participants.map((participant) => [
        participant.playerId,
        participant,
      ]),
    );
    const providerById = new Map(
      providerParticipants.map((participant) => [
        participant.canonicalPlayerId,
        participant,
      ]),
    );
    const differences: AdminProviderCheckDifference[] = [];
    const missingEvidence = new Set<
      AdminProviderCheckReport["missingEvidence"][number]
    >();
    if (observation.lineupStatus === "missing") missingEvidence.add("lineup");
    if (observation.starterCount !== 11) {
      missingEvidence.add("complete_starting_xi");
    }
    if (
      !observation.playerStatisticsAvailable &&
      !observation.substitutionEventsAvailable
    ) {
      missingEvidence.add("substitute_participation");
    }
    if (observation.coach.status === "unavailable") {
      missingEvidence.add("coach");
    }
    if (observation.fixture.status !== "finished") {
      missingEvidence.add("provider_final_status");
    }

    for (const participant of local.participants) {
      let observed = providerById.get(participant.playerId);
      if (!observed && participant.externalProviderPlayerId) {
        observed = providerParticipants.find(
          ({ externalPlayerId }) =>
            externalPlayerId === participant.externalProviderPlayerId,
        );
      }
      if (!observed) {
        const compatibleNames = providerParticipants.filter(({ name }) =>
          namesCompatible(name, participant.playerName),
        );
        if (
          compatibleNames.length === 1 &&
          !compatibleNames[0].identityResolved
        ) {
          missingEvidence.add("identity_mapping");
          continue;
        }
        if (observation.lineupStatus === "available") {
          differences.push({
            type: "missing_provider_player",
            name: participant.playerName,
          });
        }
        continue;
      }
      if (observed.squadRole !== participant.squadRole) {
        differences.push({
          type: "role_mismatch",
          name: participant.playerName,
        });
      }
      if (
        participant.squadRole === "substitute" &&
        participant.participated !== observed.participated
      ) {
        if (observed.participated || observation.lineupStatus === "available") {
          differences.push({
            type: "participation_mismatch",
            name: participant.playerName,
          });
        } else {
          missingEvidence.add("substitute_participation");
        }
      }
    }
    for (const participant of providerParticipants) {
      const compatibleLocalNames = local.participants.filter(({ playerName }) =>
        namesCompatible(playerName, participant.name),
      );
      if (
        !localById.has(participant.canonicalPlayerId) &&
        !local.participants.some(
          ({ externalProviderPlayerId, playerName }) =>
            externalProviderPlayerId === participant.externalPlayerId ||
            (!participant.identityResolved &&
              compatibleLocalNames.length === 1 &&
              namesCompatible(playerName, participant.name)),
        )
      ) {
        differences.push({
          type: "unexpected_provider_player",
          name: participant.name,
        });
      }
    }

    const providerCoachName =
      observation.coach.status === "resolved"
        ? observation.coach.value.name
        : undefined;
    if (observation.coach.status === "resolved" && local.coachId) {
      const observedCoachName = observation.coach.value.name;
      const providerCoachId = await this.canonicalCoachId(
        observation.coach.value.externalCoachId,
      );
      const localCoachSnapshot = await this.database
        .doc(`coaches/${local.coachId}`)
        .get();
      const localCoach = localCoachSnapshot.exists
        ? fromSnapshot<Coach>(localCoachSnapshot)
        : undefined;
      const directMatch =
        localCoach?.externalProvider === "api-football" &&
        localCoach.externalProviderId ===
          observation.coach.value.externalCoachId;
      if (
        providerCoachId !== local.coachId &&
        !directMatch &&
        !namesCompatible(observedCoachName, local.coachName ?? "")
      ) {
        differences.push({
          type: "coach_mismatch",
          name: observedCoachName,
        });
      } else if (providerCoachId !== local.coachId && !directMatch) {
        missingEvidence.add("identity_mapping");
      }
    }

    const status: AdminProviderCheckStatus =
      observation.fixture.status !== "finished"
        ? "stale"
        : observation.lineupStatus === "missing"
          ? "missing"
          : differences.length > 0
            ? "differences"
            : observation.lineupStatus === "partial" || missingEvidence.size > 0
              ? "partial"
              : "available";
    return {
      status,
      checkedAt,
      providerRequests: this.provider.requestCount,
      providerFixtureStatus: observation.fixture.status,
      localEvidenceSource: local.source,
      local: summarizeLocal(local),
      provider: summarizeProvider(providerParticipants, providerCoachName),
      differences,
      missingEvidence: [...missingEvidence],
    };
  }

  private async canonicalizeProviderParticipants(
    participants: ProviderMatchParticipant[],
  ): Promise<CanonicalProviderParticipant[]> {
    if (participants.length === 0) return [];
    const references = participants.map((participant) =>
      this.database.doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", participant.externalPlayerId)}`,
      ),
    );
    const snapshots = await this.database.getAll(...references);
    return participants.map((participant, index) => {
      const alias = snapshots[index].exists
        ? fromSnapshot<PlayerProviderAlias>(snapshots[index])
        : undefined;
      return {
        ...participant,
        canonicalPlayerId:
          alias?.canonicalPlayerId ??
          providerEntityId(
            "player",
            "api-football",
            participant.externalPlayerId,
          ),
        identityResolved: alias !== undefined,
      };
    });
  }

  private async canonicalCoachId(externalCoachId: string): Promise<string> {
    const snapshot = await this.database
      .doc(
        `coachProviderAliases/${coachProviderAliasId("api-football", externalCoachId)}`,
      )
      .get();
    return snapshot.exists
      ? fromSnapshot<CoachProviderAlias>(snapshot).canonicalCoachId
      : providerEntityId("coach", "api-football", externalCoachId);
  }
}

function validateInput(input: AdminProviderCheckInput): void {
  if (
    !validId(input.matchId) ||
    !validId(input.trackedTeamId) ||
    !/^\d+$/.test(input.externalFixtureId) ||
    !validId(input.operatorId)
  ) {
    throw new AdminProviderCheckRejectedError(
      "invalid_input",
      "La solicitud de comprobación no es válida.",
    );
  }
}

function summarizeLocal(local: LocalEvidence): AdminProviderCheckSide {
  return {
    starters: local.participants
      .filter(({ squadRole }) => squadRole === "starter")
      .map(localPerson),
    participatingSubstitutes: local.participants
      .filter(
        ({ squadRole, participated }) =>
          squadRole === "substitute" && participated,
      )
      .map(localPerson),
    ...(local.coachName ? { coachName: local.coachName } : {}),
  };
}

function summarizeProvider(
  participants: ProviderMatchParticipant[],
  coachName?: string,
): AdminProviderCheckSide {
  return {
    starters: participants
      .filter(({ squadRole }) => squadRole === "starter")
      .map(providerPerson),
    participatingSubstitutes: participants
      .filter(
        ({ squadRole, participated }) =>
          squadRole === "substitute" && participated,
      )
      .map(providerPerson),
    ...(coachName ? { coachName } : {}),
  };
}

function localPerson(participant: LocalParticipant): AdminProviderCheckPerson {
  return {
    name: participant.playerName,
    ...(participant.enteredAtMinute === undefined
      ? {}
      : { enteredAtMinute: participant.enteredAtMinute }),
    ...(participant.exitedAtMinute === undefined
      ? {}
      : { exitedAtMinute: participant.exitedAtMinute }),
  };
}

function providerPerson(
  participant: ProviderMatchParticipant,
): AdminProviderCheckPerson {
  return {
    name: participant.name,
    ...(participant.enteredAtMinute === undefined
      ? {}
      : { enteredAtMinute: participant.enteredAtMinute }),
    ...(participant.exitedAtMinute === undefined
      ? {}
      : { exitedAtMinute: participant.exitedAtMinute }),
  };
}

function emptyReport(
  status: AdminProviderCheckStatus,
  checkedAt: string,
  providerRequests: number,
  local: LocalEvidence,
): AdminProviderCheckReport {
  return {
    status,
    checkedAt,
    providerRequests,
    localEvidenceSource: local.source,
    local: summarizeLocal(local),
    provider: { starters: [], participatingSubstitutes: [] },
    differences: [],
    missingEvidence: [],
  };
}

function namesCompatible(left: string, right: string): boolean {
  const normalizedLeft = normalizePlayerSearch(left);
  const normalizedRight = normalizePlayerSearch(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  const leftParts = normalizedLeft.split(" ");
  const rightParts = normalizedRight.split(" ");
  if (leftParts.at(-1) !== rightParts.at(-1)) return false;
  return leftParts[0]?.[0] === rightParts[0]?.[0];
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9:_-]{1,160}$/.test(value);
}

function fromSnapshot<T>(snapshot: {
  id: string;
  data(): Record<string, unknown> | undefined;
}): T {
  const data = snapshot.data() ?? {};
  return {
    ...Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof Timestamp ? value.toDate().toISOString() : value,
      ]),
    ),
    id: snapshot.id,
  } as T;
}
