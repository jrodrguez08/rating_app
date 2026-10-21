import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { mergeTeamPlayerMembership } from "@/application/team-player-membership";
import { coachProviderAliasId } from "@/domain/coach-identity";
import type {
  Coach,
  CoachAssignment,
  CoachProviderAlias,
  Match,
  MatchParticipant,
  Player,
  PlayerProviderAlias,
  ProviderMatchObservationSnapshot,
  Team,
  TeamPlayerMembership,
  VerifiedCoachAssignment,
  VerifiedLineupSnapshot,
} from "@/domain/models";
import {
  mergePlayerForProviderSync,
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import {
  normalizePlayerSearch,
  playerSearchPrefixes,
} from "@/domain/player-search";
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
  persisted: boolean;
  evidenceObservedAt?: string;
  retainedEarlierEvidence: boolean;
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
    private readonly provider?: FootballDataProvider,
    private readonly database: Firestore = getServerFirestore(),
  ) {}

  async check(
    input: AdminProviderCheckInput,
  ): Promise<AdminProviderCheckReport> {
    validateInput(input);
    const local = await this.loadLocalEvidence(input);
    const checkedAt = await this.claim(input.operatorId, input.matchId);
    const provider = this.provider;
    if (!provider?.inspectMatchEvidence) {
      throw new Error("The configured provider cannot inspect match evidence.");
    }
    let observation: ProviderMatchObservation;
    try {
      observation = await provider.inspectMatchEvidence(
        input.externalFixtureId,
        local.externalTeamId,
        local.match.kickoffAt,
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        const retained = await this.loadSnapshot(input.matchId);
        if (retained) {
          const report = await this.compare(
            local,
            observationFromSnapshot(retained),
            checkedAt,
            true,
            retained.evidenceObservedAt,
            retained.providerRequests,
            retained.latestLineupStatus !== retained.lineupStatus,
          );
          return {
            ...report,
            status: "provider_error",
            providerRequests: provider.requestCount,
          };
        }
        return emptyReport(
          "provider_error",
          checkedAt,
          provider.requestCount,
          local,
        );
      }
      throw error;
    }
    const snapshot = await this.persistObservation(
      local,
      observation,
      checkedAt,
    );
    const report = await this.compare(
      local,
      observationFromSnapshot(snapshot),
      checkedAt,
      true,
      snapshot.evidenceObservedAt,
      provider.requestCount,
      snapshot.latestLineupStatus !== snapshot.lineupStatus,
    );
    return withLatestLineupStatus(report, observation.lineupStatus);
  }

  async readPersisted(
    input: Omit<AdminProviderCheckInput, "operatorId">,
  ): Promise<AdminProviderCheckReport | null> {
    validateBindingInput(input);
    const local = await this.loadLocalEvidence({
      ...input,
      operatorId: "persisted-read",
    });
    const snapshot = await this.loadSnapshot(input.matchId);
    if (!snapshot) return null;
    const report = await this.compare(
      local,
      observationFromSnapshot(snapshot),
      snapshot.observedAt,
      true,
      snapshot.evidenceObservedAt,
      snapshot.providerRequests,
      snapshot.latestLineupStatus !== snapshot.lineupStatus,
    );
    return withLatestLineupStatus(report, snapshot.latestLineupStatus);
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

  private async loadSnapshot(
    matchId: string,
  ): Promise<ProviderMatchObservationSnapshot | null> {
    const snapshot = await this.database
      .doc(`matches/${matchId}/providerObservations/api-football`)
      .get();
    return snapshot.exists
      ? fromSnapshot<ProviderMatchObservationSnapshot>(snapshot)
      : null;
  }

  private async persistObservation(
    local: LocalEvidence,
    observation: ProviderMatchObservation,
    checkedAt: string,
  ): Promise<ProviderMatchObservationSnapshot> {
    const trackedParticipants = observation.participants.filter(
      ({ externalTeamId }) => externalTeamId === local.externalTeamId,
    );
    const uniqueParticipants = [
      ...new Map(
        trackedParticipants.map((participant) => [
          participant.externalPlayerId,
          participant,
        ]),
      ).values(),
    ];
    const matchReference = this.database.doc(`matches/${local.match.id}`);
    const resultReference = this.database.doc(
      `matches/${local.match.id}/results/summary`,
    );
    const snapshotReference = this.database.doc(
      `matches/${local.match.id}/providerObservations/api-football`,
    );
    const aliasReferences = uniqueParticipants.map((participant) =>
      this.database.doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", participant.externalPlayerId)}`,
      ),
    );
    const resolvedCoach =
      observation.coach.status === "resolved" ? observation.coach.value : null;
    const coachAliasReference = resolvedCoach
      ? this.database.doc(
          `coachProviderAliases/${coachProviderAliasId("api-football", resolvedCoach.externalCoachId)}`,
        )
      : null;

    return this.database.runTransaction(async (transaction) => {
      const [matchSnapshot, resultSnapshot, existingSnapshot] =
        await Promise.all([
          transaction.get(matchReference),
          transaction.get(resultReference),
          transaction.get(snapshotReference),
        ]);
      if (!matchSnapshot.exists || !resultSnapshot.exists) {
        throw new AdminProviderCheckRejectedError(
          "not_finalized",
          "La comprobaci\u00f3n est\u00e1 disponible cuando los resultados ya fueron publicados.",
        );
      }
      const match = fromSnapshot<Match>(matchSnapshot);
      if (
        match.id !== local.match.id ||
        match.trackedTeamId !== local.match.trackedTeamId ||
        match.externalProvider !== "api-football" ||
        match.externalProviderFixtureId !==
          local.match.externalProviderFixtureId ||
        match.ratingState !== "rating_closed"
      ) {
        throw new AdminProviderCheckRejectedError(
          "binding_conflict",
          "El equipo o fixture no coincide con el partido seleccionado.",
        );
      }
      const aliasSnapshots =
        aliasReferences.length === 0
          ? []
          : await transaction.getAll(...aliasReferences);
      const canonicalPlayerIds = uniqueParticipants.map(
        (participant, index) => {
          const alias = aliasSnapshots[index]?.exists
            ? fromSnapshot<PlayerProviderAlias>(aliasSnapshots[index])
            : undefined;
          return {
            participant,
            aliasResolved: alias !== undefined,
            playerId:
              alias?.canonicalPlayerId ??
              providerEntityId(
                "player",
                "api-football",
                participant.externalPlayerId,
              ),
            canonicalExternalProviderPlayerId:
              alias?.canonicalExternalProviderPlayerId ??
              participant.externalPlayerId,
          };
        },
      );
      const playerReferences = canonicalPlayerIds.map(({ playerId }) =>
        this.database.doc(`players/${playerId}`),
      );
      const membershipReferences = canonicalPlayerIds.map(({ playerId }) =>
        this.database.doc(
          `teams/${local.match.trackedTeamId}/playerMemberships/${playerId}`,
        ),
      );
      const playerSnapshots =
        playerReferences.length === 0
          ? []
          : await transaction.getAll(...playerReferences);
      const membershipSnapshots =
        membershipReferences.length === 0
          ? []
          : await transaction.getAll(...membershipReferences);
      const coachAliasSnapshot = coachAliasReference
        ? await transaction.get(coachAliasReference)
        : null;
      const coachId = resolvedCoach
        ? coachAliasSnapshot?.exists
          ? fromSnapshot<CoachProviderAlias>(coachAliasSnapshot)
              .canonicalCoachId
          : providerEntityId(
              "coach",
              "api-football",
              resolvedCoach.externalCoachId,
            )
        : null;
      const coachReference = coachId
        ? this.database.doc(`coaches/${coachId}`)
        : null;
      const coachSnapshot = coachReference
        ? await transaction.get(coachReference)
        : null;
      if (
        canonicalPlayerIds.some(
          ({ aliasResolved }, index) =>
            aliasResolved && !playerSnapshots[index]?.exists,
        ) ||
        (coachAliasSnapshot?.exists && !coachSnapshot?.exists)
      ) {
        throw new Error("A reviewed provider alias has no canonical identity.");
      }

      canonicalPlayerIds.forEach(
        (
          { participant, playerId, canonicalExternalProviderPlayerId },
          index,
        ) => {
          const existingPlayer = playerSnapshots[index]?.exists
            ? fromSnapshot<Player>(playerSnapshots[index])
            : undefined;
          const incomingPlayer: Player = {
            id: playerId,
            displayName: participant.name,
            identityProvenance: "provider",
            externalProvider: "api-football",
            externalProviderId: canonicalExternalProviderPlayerId,
            ...(participant.position ? { position: participant.position } : {}),
            createdAt: checkedAt,
            updatedAt: checkedAt,
          };
          const player = mergeObservedPlayer(existingPlayer, incomingPlayer);
          const incomingMembership: TeamPlayerMembership = {
            playerId,
            teamId: local.match.trackedTeamId,
            displayName: player.displayName,
            searchName: normalizePlayerSearch(player.displayName),
            searchPrefixes: playerSearchPrefixes(player.displayName),
            source: "provider_observation",
            sourceMatchId: local.match.id,
            ...(participant.shirtNumber === undefined
              ? {}
              : { shirtNumber: participant.shirtNumber }),
            firstObservedAt: checkedAt,
            lastObservedAt: checkedAt,
            createdAt: checkedAt,
            updatedAt: checkedAt,
          };
          const existingMembership = membershipSnapshots[index]?.exists
            ? fromSnapshot<TeamPlayerMembership>(membershipSnapshots[index])
            : undefined;
          transaction.set(playerReferences[index], toDocument(player));
          transaction.set(
            membershipReferences[index],
            toDocument(
              mergeTeamPlayerMembership(existingMembership, incomingMembership),
            ),
          );
        },
      );

      if (resolvedCoach && coachReference) {
        const incomingCoach: Coach = {
          id: coachReference.id,
          displayName: resolvedCoach.name,
          identityProvenance: "provider",
          externalProvider: "api-football",
          externalProviderId: resolvedCoach.externalCoachId,
          ...(resolvedCoach.photoUrl
            ? { photoUrl: resolvedCoach.photoUrl }
            : {}),
          createdAt: checkedAt,
          updatedAt: checkedAt,
        };
        const existingCoach = coachSnapshot?.exists
          ? fromSnapshot<Coach>(coachSnapshot)
          : undefined;
        transaction.set(
          coachReference,
          toDocument(mergeObservedCoach(existingCoach, incomingCoach)),
        );
      }

      const existing = existingSnapshot.exists
        ? fromSnapshot<ProviderMatchObservationSnapshot>(existingSnapshot)
        : undefined;
      const persisted = mergeObservationSnapshot(
        existing,
        local,
        observation,
        checkedAt,
        this.provider?.requestCount ?? 0,
      );
      transaction.set(snapshotReference, toDocument(persisted));
      return persisted;
    });
  }

  private async compare(
    local: LocalEvidence,
    observation: ProviderMatchObservation,
    checkedAt: string,
    persisted = false,
    evidenceObservedAt?: string,
    providerRequests = this.provider?.requestCount ?? 0,
    retainedEarlierEvidence = false,
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
      providerRequests,
      providerFixtureStatus: observation.fixture.status,
      localEvidenceSource: local.source,
      local: summarizeLocal(local),
      provider: summarizeProvider(providerParticipants, providerCoachName),
      differences,
      missingEvidence: [...missingEvidence],
      persisted,
      ...(evidenceObservedAt ? { evidenceObservedAt } : {}),
      retainedEarlierEvidence,
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
  validateBindingInput(input);
  if (!validId(input.operatorId)) {
    throw new AdminProviderCheckRejectedError(
      "invalid_input",
      "La solicitud de comprobaci\u00f3n no es v\u00e1lida.",
    );
  }
}

function validateBindingInput(
  input: Omit<AdminProviderCheckInput, "operatorId">,
): void {
  if (
    !validId(input.matchId) ||
    !validId(input.trackedTeamId) ||
    !/^\d+$/.test(input.externalFixtureId)
  ) {
    throw new AdminProviderCheckRejectedError(
      "invalid_input",
      "La solicitud de comprobación no es válida.",
    );
  }
}

function mergeObservationSnapshot(
  existing: ProviderMatchObservationSnapshot | undefined,
  local: LocalEvidence,
  observation: ProviderMatchObservation,
  checkedAt: string,
  providerRequests: number,
): ProviderMatchObservationSnapshot {
  const incomingParticipants = observation.participants.filter(
    ({ externalTeamId }) => externalTeamId === local.externalTeamId,
  );
  const previousParticipants = existing?.participants ?? [];
  const participants = new Map(
    previousParticipants.map((participant) => [
      participant.externalPlayerId,
      participant,
    ]),
  );
  for (const participant of incomingParticipants) {
    const previous = participants.get(participant.externalPlayerId);
    participants.set(participant.externalPlayerId, {
      ...previous,
      ...participant,
      participated: previous?.participated === true || participant.participated,
      ...(participant.enteredAtMinute === undefined &&
      previous?.enteredAtMinute !== undefined
        ? { enteredAtMinute: previous.enteredAtMinute }
        : {}),
      ...(participant.exitedAtMinute === undefined &&
      previous?.exitedAtMinute !== undefined
        ? { exitedAtMinute: previous.exitedAtMinute }
        : {}),
    });
  }
  const retainedParticipants = [...participants.values()];
  const retainedCoach =
    observation.coach.status === "resolved"
      ? {
          status: "resolved" as const,
          ...observation.coach.value,
        }
      : existing?.coach.status === "resolved"
        ? existing.coach
        : observation.coach;
  const evidenceAdvanced =
    !existing ||
    incomingParticipants.length > 0 ||
    observation.coach.status === "resolved" ||
    lineupRank(observation.lineupStatus) > lineupRank(existing.lineupStatus);
  const lineupStatus =
    lineupRank(observation.lineupStatus) >=
    lineupRank(existing?.lineupStatus ?? "missing")
      ? observation.lineupStatus
      : (existing?.lineupStatus ?? observation.lineupStatus);
  return {
    id: "api-football",
    matchId: local.match.id,
    trackedTeamId: local.match.trackedTeamId,
    externalProvider: "api-football",
    externalFixtureId: local.match.externalProviderFixtureId,
    externalTeamId: local.externalTeamId,
    fixture: {
      externalCompetitionId: observation.fixture.externalCompetitionId,
      providerSeason: observation.fixture.providerSeason,
      status: observation.fixture.status,
      kickoffAt: observation.fixture.kickoffAt,
      homeTeam: observation.fixture.homeTeam,
      awayTeam: observation.fixture.awayTeam,
      score: observation.fixture.score,
    },
    lineupStatus,
    latestLineupStatus: observation.lineupStatus,
    starterCount: retainedParticipants.filter(
      ({ squadRole }) => squadRole === "starter",
    ).length,
    substituteCount: retainedParticipants.filter(
      ({ squadRole }) => squadRole === "substitute",
    ).length,
    playerStatisticsAvailable:
      (existing?.playerStatisticsAvailable ?? false) ||
      observation.playerStatisticsAvailable,
    substitutionEventsAvailable:
      (existing?.substitutionEventsAvailable ?? false) ||
      observation.substitutionEventsAvailable,
    providerRequests: Math.max(0, Math.floor(providerRequests)),
    participants: retainedParticipants,
    coach: retainedCoach,
    observedAt: checkedAt,
    evidenceObservedAt: evidenceAdvanced
      ? checkedAt
      : (existing?.evidenceObservedAt ?? checkedAt),
    createdAt: existing?.createdAt ?? checkedAt,
    updatedAt: checkedAt,
  };
}

function lineupRank(status: ProviderMatchObservation["lineupStatus"]): number {
  switch (status) {
    case "available":
      return 2;
    case "partial":
      return 1;
    case "missing":
      return 0;
  }
}

function observationFromSnapshot(
  snapshot: ProviderMatchObservationSnapshot,
): ProviderMatchObservation {
  return {
    fixture: {
      externalFixtureId: snapshot.externalFixtureId,
      externalCompetitionId: snapshot.fixture.externalCompetitionId,
      providerSeason: snapshot.fixture.providerSeason,
      kickoffAt: snapshot.fixture.kickoffAt,
      status: snapshot.fixture.status,
      homeTeam: snapshot.fixture.homeTeam,
      awayTeam: snapshot.fixture.awayTeam,
      score: snapshot.fixture.score,
    },
    lineupStatus: snapshot.lineupStatus,
    starterCount: snapshot.starterCount,
    substituteCount: snapshot.substituteCount,
    playerStatisticsAvailable: snapshot.playerStatisticsAvailable,
    substitutionEventsAvailable: snapshot.substitutionEventsAvailable,
    participants: snapshot.participants,
    coach:
      snapshot.coach.status === "resolved"
        ? {
            status: "resolved",
            value: {
              externalTeamId: snapshot.coach.externalTeamId,
              externalCoachId: snapshot.coach.externalCoachId,
              name: snapshot.coach.name,
              ...(snapshot.coach.photoUrl
                ? { photoUrl: snapshot.coach.photoUrl }
                : {}),
            },
          }
        : snapshot.coach,
  };
}

function mergeObservedCoach(
  existing: Coach | undefined,
  incoming: Coach,
): Coach {
  if (!existing) return incoming;
  if (existing.identityProvenance === "operator_verified") {
    return existing;
  }
  return {
    ...existing,
    ...incoming,
    externalProviderId:
      existing.externalProviderId ?? incoming.externalProviderId,
    createdAt: existing.createdAt,
  };
}

function mergeObservedPlayer(
  existing: Player | undefined,
  incoming: Player,
): Player {
  if (existing?.identityProvenance === "operator_verified") return existing;
  const merged = mergePlayerForProviderSync(existing, incoming);
  if (!existing) return merged;
  const existingValue = { ...existing } as Partial<Player>;
  const mergedValue = { ...merged } as Partial<Player>;
  delete existingValue.updatedAt;
  delete mergedValue.updatedAt;
  return JSON.stringify(existingValue) === JSON.stringify(mergedValue)
    ? existing
    : merged;
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
    persisted: false,
    retainedEarlierEvidence: false,
  };
}

function withLatestLineupStatus(
  report: AdminProviderCheckReport,
  latest: ProviderMatchObservation["lineupStatus"],
): AdminProviderCheckReport {
  if (latest === "missing") return { ...report, status: "missing" };
  if (latest === "partial" && report.status === "available") {
    return { ...report, status: "partial" };
  }
  return report;
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

function toDocument(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, field]) => key !== "id" && field !== undefined)
      .map(([key, field]) => [
        key,
        ["observedAt", "evidenceObservedAt", "createdAt", "updatedAt"].includes(
          key,
        ) && typeof field === "string"
          ? Timestamp.fromDate(new Date(field))
          : field,
      ]),
  );
}
