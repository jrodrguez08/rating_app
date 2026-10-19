import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  membershipFromParticipant,
  mergeTeamPlayerMembership,
} from "@/application/team-player-membership";
import type {
  AdminLineupDraft,
  Match,
  MatchParticipant,
  Player,
  TeamPlayerMembership,
  VerifiedLineupParticipant,
  VerifiedLineupSnapshot,
} from "@/domain/models";
import { playerProviderAliasId } from "@/domain/player-identity";
import {
  type AdminLineupAction,
  type AdminLineupParticipantAction,
  adminLineupAuditId,
  hashAdminLineupAction,
} from "@/lib/server/admin-lineup-action";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import { verifyInternalPlayerAllocationToken } from "@/lib/server/admin-player-identity-allocation";

import { getServerFirestore } from "./server";

const MAX_PARTICIPANTS = 30;

export interface AdminVerifiedLineupInput extends AdminLineupAction {
  operatorId: string;
}

export interface AdminVerifiedLineupPlan {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  currentParticipants: Array<{
    playerId: string;
    playerName: string;
    squadRole: MatchParticipant["squadRole"];
    participationStatus: NonNullable<MatchParticipant["participationStatus"]>;
  }>;
  proposedParticipants: Array<{
    playerId: string;
    playerName: string;
    squadRole: MatchParticipant["squadRole"];
    participationStatus: NonNullable<MatchParticipant["participationStatus"]>;
    enteredAtMinute?: number;
  }>;
  internalPlayersCreated: string[];
  participantCreates: number;
  participantUpdates: number;
  participantDeletes: number;
}

export interface AdminVerifiedLineupResult {
  plan: AdminVerifiedLineupPlan;
  auditId: string;
  disposition: "committed" | "idempotent_retry";
}

export class AdminVerifiedLineupRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminVerifiedLineupRejectedError";
  }
}

export class AdminVerifiedLineupCommitError extends Error {
  constructor() {
    super("Verified lineup commit failed.");
    this.name = "AdminVerifiedLineupCommitError";
  }
}

export class AdminVerifiedLineupService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async preview(
    input: AdminVerifiedLineupInput,
  ): Promise<AdminVerifiedLineupPlan> {
    const result = await this.execute(input);
    if ("auditId" in result) throw new Error("Unexpected audit receipt.");
    return result;
  }

  async applyAuthorized(
    input: AdminVerifiedLineupInput,
    challengeToken: string | undefined,
  ): Promise<AdminVerifiedLineupResult> {
    if (!challengeToken || challengeToken.length > 256) {
      throw new AdminVerifiedLineupRejectedError(
        "Admin action challenge is invalid.",
      );
    }
    try {
      const result = await this.execute(input, challengeToken);
      if (!("auditId" in result)) throw new Error("Audit receipt is missing.");
      return result;
    } catch (error) {
      if (error instanceof AdminVerifiedLineupRejectedError) throw error;
      throw new AdminVerifiedLineupCommitError();
    }
  }

  private async execute(
    input: AdminVerifiedLineupInput,
    challengeToken?: string,
  ): Promise<AdminVerifiedLineupPlan | AdminVerifiedLineupResult> {
    validateInput(input);
    const challengeId = challengeToken
      ? adminChallengeDocumentId(challengeToken)
      : undefined;
    const auditId = challengeId ? adminLineupAuditId(challengeId) : undefined;
    const actionHash = hashAdminLineupAction(input);

    return this.database.runTransaction(async (transaction) => {
      const challengeReference = challengeId
        ? this.database.doc(`adminActionChallenges/${challengeId}`)
        : undefined;
      const auditReference = auditId
        ? this.database.doc(`adminAudit/${auditId}`)
        : undefined;

      if (challengeReference && auditReference && auditId) {
        const challengeSnapshot = await transaction.get(challengeReference);
        const challenge = challengeSnapshot.data();
        if (
          !challengeSnapshot.exists ||
          challenge?.operatorUid !== input.operatorId ||
          challenge.matchId !== input.matchId ||
          challenge.actionHash !== actionHash ||
          !(challenge.expiresAt instanceof Timestamp)
        ) {
          throw new AdminVerifiedLineupRejectedError(
            "Admin action challenge is invalid.",
          );
        }
        if (challenge.consumedAt !== undefined) {
          if (
            !(challenge.consumedAt instanceof Timestamp) ||
            challenge.committedAuditId !== auditId
          ) {
            throw new AdminVerifiedLineupRejectedError(
              "Admin action challenge is invalid.",
            );
          }
          const auditSnapshot = await transaction.get(auditReference);
          const audit = auditSnapshot.data();
          const plan = receiptPlan(audit?.plan, input);
          if (
            !auditSnapshot.exists ||
            audit?.operatorUid !== input.operatorId ||
            audit.action !== "lineup_preparation_apply" ||
            audit.matchId !== input.matchId ||
            audit.trackedTeamId !== input.trackedTeamId ||
            audit.externalFixtureId !== input.externalFixtureId ||
            audit.actionHash !== actionHash ||
            audit.outcome !== "success" ||
            audit.commitDisposition !== "committed" ||
            !(audit.createdAt instanceof Timestamp) ||
            plan === null
          ) {
            throw new AdminVerifiedLineupRejectedError(
              "Committed admin action audit is invalid.",
            );
          }
          return { plan, auditId, disposition: "idempotent_retry" as const };
        }
        if (
          challenge.committedAuditId !== undefined ||
          challenge.expiresAt.toMillis() <=
            challengeSnapshot.readTime.toMillis()
        ) {
          throw new AdminVerifiedLineupRejectedError(
            "Admin action challenge is invalid.",
          );
        }
      }

      const matchReference = this.database.doc(`matches/${input.matchId}`);
      const resultReference = this.database.doc(
        `matches/${input.matchId}/results/summary`,
      );
      const verifiedReference = this.database.doc(
        `matches/${input.matchId}/verifiedLineups/current`,
      );
      const draftReference = this.database.doc(
        `matches/${input.matchId}/lineupDrafts/${input.operatorId}`,
      );
      const participantCollection = this.database.collection(
        `matches/${input.matchId}/participants`,
      );
      const ballotQuery = this.database
        .collection(`matches/${input.matchId}/ballots`)
        .limit(1);
      const revisionQuery = this.database
        .collection(`matches/${input.matchId}/resultRevisions`)
        .limit(1);
      const playerReferences = input.participants.map((participant) =>
        this.database.doc(`players/${participant.playerId}`),
      );
      const [
        matchSnapshot,
        resultSnapshot,
        verifiedSnapshot,
        draftSnapshot,
        participantSnapshot,
        ballots,
        revisions,
        ...playerSnapshots
      ] = await Promise.all([
        transaction.get(matchReference),
        transaction.get(resultReference),
        transaction.get(verifiedReference),
        transaction.get(draftReference),
        transaction.get(participantCollection),
        transaction.get(ballotQuery),
        transaction.get(revisionQuery),
        ...playerReferences.map((reference) => transaction.get(reference)),
      ]);
      if (!matchSnapshot.exists) {
        throw new AdminVerifiedLineupRejectedError("Match was not found.");
      }
      const match = fromSnapshot<Match>(matchSnapshot);
      if (
        match.trackedTeamId !== input.trackedTeamId ||
        match.externalProviderFixtureId !== input.externalFixtureId
      ) {
        throw new AdminVerifiedLineupRejectedError(
          "The Team or fixture binding is invalid.",
        );
      }
      if (
        !["scheduled", "live", "finished"].includes(match.status) ||
        !["not_ready", "preparing_rating"].includes(match.ratingState) ||
        resultSnapshot.exists ||
        !ballots.empty ||
        !revisions.empty
      ) {
        throw new AdminVerifiedLineupRejectedError(
          "Lineup preparation is not permitted for this match state.",
        );
      }

      const existingParticipants = new Map(
        participantSnapshot.docs.map((snapshot) => [
          snapshot.id,
          fromSnapshot<MatchParticipant>(snapshot),
        ]),
      );
      const existingDraft = draftSnapshot.exists
        ? fromSnapshot<AdminLineupDraft>(draftSnapshot)
        : undefined;
      if (
        existingDraft &&
        (existingDraft.ownerId !== input.operatorId ||
          existingDraft.matchId !== input.matchId ||
          existingDraft.trackedTeamId !== input.trackedTeamId ||
          existingDraft.externalFixtureId !== input.externalFixtureId)
      ) {
        throw new AdminVerifiedLineupRejectedError(
          "Saved lineup draft binding is invalid.",
        );
      }
      const membershipReferences = input.participants.map((participant) =>
        this.database.doc(
          `teams/${input.trackedTeamId}/playerMemberships/${participant.playerId}`,
        ),
      );
      const membershipSnapshots = await transaction.getAll(
        ...membershipReferences,
      );
      const draftPlayerIds = new Set(
        existingDraft?.participants.map(
          (participant) => participant.playerId,
        ) ?? [],
      );
      const timestamp = matchSnapshot.readTime.toDate().toISOString();
      const players: Player[] = [];
      const internalPlayerIds: string[] = [];
      for (const [index, participant] of input.participants.entries()) {
        const snapshot = playerSnapshots[index];
        if (participant.createInternalIdentity) {
          if (
            snapshot.exists ||
            !participant.playerName ||
            !verifyInternalPlayerAllocationToken(
              participant.identityAllocationToken,
              {
                playerId: participant.playerId,
                ownerId: input.operatorId,
                matchId: input.matchId,
                trackedTeamId: input.trackedTeamId,
              },
            )
          ) {
            throw new AdminVerifiedLineupRejectedError(
              "Internal player identity conflicts with an existing Player.",
            );
          }
          internalPlayerIds.push(participant.playerId);
          players.push({
            id: participant.playerId,
            displayName: participant.playerName,
            identityProvenance: "operator_verified",
            currentTeamId: input.trackedTeamId,
            ...(participant.position ? { position: participant.position } : {}),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          continue;
        }
        if (!snapshot.exists) {
          throw new AdminVerifiedLineupRejectedError(
            "Canonical player identity was not found.",
          );
        }
        const player = fromSnapshot<Player>(snapshot);
        const currentParticipant = existingParticipants.get(player.id);
        const membership = membershipSnapshots[index].exists
          ? fromSnapshot<TeamPlayerMembership>(membershipSnapshots[index])
          : undefined;
        if (
          player.currentTeamId !== input.trackedTeamId &&
          currentParticipant?.teamId !== input.trackedTeamId &&
          membership?.teamId !== input.trackedTeamId &&
          !draftPlayerIds.has(player.id)
        ) {
          throw new AdminVerifiedLineupRejectedError(
            "Canonical player does not belong to the tracked Team.",
          );
        }
        if (
          participant.playerName !== undefined &&
          participant.playerName !== player.displayName
        ) {
          throw new AdminVerifiedLineupRejectedError(
            "Canonical player identity conflicts with the proposed name.",
          );
        }
        players.push(player);
      }

      const aliasPairs = players
        .map((player, index) => ({ player, index }))
        .filter(
          ({ player }) =>
            player.externalProvider !== undefined &&
            player.externalProviderId !== undefined,
        );
      if (aliasPairs.length > 0) {
        const aliases = await transaction.getAll(
          ...aliasPairs.map(({ player }) =>
            this.database.doc(
              `playerProviderAliases/${playerProviderAliasId(
                player.externalProvider!,
                player.externalProviderId!,
              )}`,
            ),
          ),
        );
        aliases.forEach((snapshot, index) => {
          if (
            snapshot.exists &&
            snapshot.data()?.canonicalPlayerId !== aliasPairs[index].player.id
          ) {
            throw new AdminVerifiedLineupRejectedError(
              "Canonical player alias conflicts with the selected Player.",
            );
          }
        });
      }

      const verifiedParticipants = input.participants.map(
        (participant, index): VerifiedLineupParticipant => {
          const player = players[index];
          return {
            playerId: player.id,
            playerName: player.displayName,
            squadRole: participant.squadRole,
            participationStatus: participant.participationStatus,
            participated: isParticipated(participant.participationStatus),
            identityProvenance:
              player.identityProvenance ??
              (player.externalProviderId ? "provider" : "operator_verified"),
            ...(player.externalProviderId
              ? { externalProviderPlayerId: player.externalProviderId }
              : {}),
            ...(participant.shirtNumber === undefined
              ? {}
              : { shirtNumber: participant.shirtNumber }),
            ...((participant.position ?? player.position)
              ? { position: participant.position ?? player.position }
              : {}),
            ...(participant.enteredAtMinute === undefined
              ? {}
              : { enteredAtMinute: participant.enteredAtMinute }),
            verificationSource: input.verificationSource,
            verificationReason: input.verificationReason,
            verifiedBy: input.operatorId,
            verifiedAt: timestamp,
          };
        },
      );
      const materialized = verifiedParticipants.map(
        (participant): MatchParticipant => ({
          matchId: input.matchId,
          playerId: participant.playerId,
          teamId: input.trackedTeamId,
          ...(participant.externalProviderPlayerId
            ? { externalProvider: match.externalProvider }
            : {}),
          externalProviderTeamId:
            match.trackedTeamExternalProviderId ??
            missingTrackedExternalTeamId(),
          ...(participant.externalProviderPlayerId
            ? {
                externalProviderPlayerId: participant.externalProviderPlayerId,
              }
            : {}),
          playerName: participant.playerName,
          ...(participant.shirtNumber === undefined
            ? {}
            : { shirtNumber: participant.shirtNumber }),
          ...(participant.position === undefined
            ? {}
            : { position: participant.position }),
          squadRole: participant.squadRole,
          starter: participant.squadRole === "starter",
          participated: participant.participated,
          participationStatus: participant.participationStatus,
          identityProvenance: participant.identityProvenance,
          participationProvenance: "operator_verified",
          verificationSource: participant.verificationSource,
          verificationReason: participant.verificationReason,
          verifiedBy: participant.verifiedBy,
          verifiedAt: participant.verifiedAt,
          ...(participant.enteredAtMinute === undefined
            ? {}
            : { enteredAtMinute: participant.enteredAtMinute }),
          createdAt:
            existingParticipants.get(participant.playerId)?.createdAt ??
            timestamp,
          updatedAt: timestamp,
        }),
      );
      const proposedIds = new Set(materialized.map(({ playerId }) => playerId));
      const participantCreates = materialized.filter(
        ({ playerId }) => !existingParticipants.has(playerId),
      ).length;
      const participantUpdates = materialized.filter((participant) => {
        const current = existingParticipants.get(participant.playerId);
        return (
          current !== undefined &&
          comparable(current) !== comparable(participant)
        );
      }).length;
      const participantDeletes = [...existingParticipants.keys()].filter(
        (playerId) => !proposedIds.has(playerId),
      ).length;
      const plan: AdminVerifiedLineupPlan = {
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: input.externalFixtureId,
        currentParticipants: [...existingParticipants.values()].map(
          participantSummary,
        ),
        proposedParticipants: materialized.map(participantSummary),
        internalPlayersCreated: internalPlayerIds,
        participantCreates,
        participantUpdates,
        participantDeletes,
      };

      if (!challengeReference || !auditReference || !auditId) return plan;

      for (const playerId of internalPlayerIds) {
        const actionIndex = input.participants.findIndex(
          (participant) => participant.playerId === playerId,
        );
        transaction.create(
          playerReferences[actionIndex],
          toDocument(players[actionIndex]),
        );
      }
      for (const participant of materialized) {
        transaction.set(
          participantCollection.doc(participant.playerId),
          toDocument(participant),
        );
      }
      materialized.forEach((participant, index) => {
        const membership = membershipFromParticipant(participant);
        const existing = membershipSnapshots[index].exists
          ? fromSnapshot<TeamPlayerMembership>(membershipSnapshots[index])
          : undefined;
        transaction.set(
          membershipReferences[index],
          toDocument(mergeTeamPlayerMembership(existing, membership)),
        );
      });
      for (const document of participantSnapshot.docs) {
        if (!proposedIds.has(document.id)) transaction.delete(document.ref);
      }
      const snapshot: VerifiedLineupSnapshot = {
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalProvider: match.externalProvider,
        externalFixtureId: input.externalFixtureId,
        participants: verifiedParticipants,
        operatorId: input.operatorId,
        verificationSource: input.verificationSource,
        verificationReason: input.verificationReason,
        provenance: "operator_verified",
        verifiedAt: timestamp,
        createdAt: verifiedSnapshot.exists
          ? fromSnapshot<VerifiedLineupSnapshot>(verifiedSnapshot).createdAt
          : timestamp,
        updatedAt: timestamp,
      };
      transaction.set(verifiedReference, toDocument(snapshot));
      if (draftSnapshot.exists) transaction.delete(draftReference);
      transaction.update(challengeReference, {
        consumedAt: Timestamp.fromDate(matchSnapshot.readTime.toDate()),
        committedAuditId: auditId,
      });
      transaction.create(auditReference, {
        operatorUid: input.operatorId,
        action: "lineup_preparation_apply",
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: input.externalFixtureId,
        evidenceReference: input.verificationSource,
        verificationReason: input.verificationReason,
        actionHash,
        outcome: "success",
        commitDisposition: "committed",
        plan: toDocument(plan),
        createdAt: Timestamp.fromDate(matchSnapshot.readTime.toDate()),
      });
      return { plan, auditId, disposition: "committed" as const };
    });
  }
}

function validateInput(input: AdminVerifiedLineupInput): void {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.matchId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.trackedTeamId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.externalFixtureId) ||
    !/^[A-Za-z0-9_.@:-]{1,128}$/.test(input.operatorId) ||
    input.participants.length < 11 ||
    input.participants.length > MAX_PARTICIPANTS ||
    !validHttpsUrl(input.verificationSource) ||
    input.verificationReason.trim().length < 10 ||
    input.verificationReason.length > 500
  ) {
    throw new AdminVerifiedLineupRejectedError("Lineup input is invalid.");
  }
  const ids = new Set<string>();
  let starters = 0;
  for (const participant of input.participants) {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(participant.playerId) ||
      ids.has(participant.playerId) ||
      (participant.playerName !== undefined &&
        (participant.playerName.trim().length < 2 ||
          participant.playerName.length > 120)) ||
      (participant.createInternalIdentity && !participant.playerName) ||
      !validRoleStatus(participant) ||
      (participant.shirtNumber !== undefined &&
        (!Number.isInteger(participant.shirtNumber) ||
          participant.shirtNumber < 1 ||
          participant.shirtNumber > 99)) ||
      (participant.enteredAtMinute !== undefined &&
        (!Number.isInteger(participant.enteredAtMinute) ||
          participant.enteredAtMinute < 1 ||
          participant.enteredAtMinute > 130))
    ) {
      throw new AdminVerifiedLineupRejectedError("Lineup input is invalid.");
    }
    if (
      participant.createInternalIdentity !==
      verifyInternalPlayerAllocationToken(participant.identityAllocationToken, {
        playerId: participant.playerId,
        ownerId: input.operatorId,
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
      })
    ) {
      throw new AdminVerifiedLineupRejectedError(
        "Internal Player allocation is invalid.",
      );
    }
    ids.add(participant.playerId);
    if (participant.squadRole === "starter") starters += 1;
  }
  if (starters !== 11) {
    throw new AdminVerifiedLineupRejectedError(
      "Verified lineup must contain exactly 11 starters.",
    );
  }
}

function validRoleStatus(participant: AdminLineupParticipantAction): boolean {
  if (participant.squadRole === "starter") {
    return (
      participant.participationStatus === "confirmed_starter" &&
      participant.enteredAtMinute === undefined
    );
  }
  if (participant.participationStatus === "confirmed_starter") return false;
  return (
    participant.participationStatus === "confirmed_substitute" ||
    participant.enteredAtMinute === undefined
  );
}

function isParticipated(
  status: AdminLineupParticipantAction["participationStatus"],
): boolean {
  return status === "confirmed_starter" || status === "confirmed_substitute";
}

function validHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function missingTrackedExternalTeamId(): never {
  throw new AdminVerifiedLineupRejectedError(
    "Tracked Team provider identity is missing from the Match.",
  );
}

function participantSummary(participant: MatchParticipant) {
  return {
    playerId: participant.playerId,
    playerName: participant.playerName,
    squadRole: participant.squadRole,
    participationStatus:
      participant.participationStatus ??
      (participant.squadRole === "starter"
        ? ("confirmed_starter" as const)
        : participant.participated
          ? ("confirmed_substitute" as const)
          : ("unused_substitute" as const)),
    ...(participant.enteredAtMinute === undefined
      ? {}
      : { enteredAtMinute: participant.enteredAtMinute }),
  };
}

function receiptPlan(
  value: unknown,
  input: AdminVerifiedLineupInput,
): AdminVerifiedLineupPlan | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("matchId" in value) ||
    value.matchId !== input.matchId ||
    !("trackedTeamId" in value) ||
    value.trackedTeamId !== input.trackedTeamId ||
    !("externalFixtureId" in value) ||
    value.externalFixtureId !== input.externalFixtureId ||
    !("currentParticipants" in value) ||
    !Array.isArray(value.currentParticipants) ||
    !("proposedParticipants" in value) ||
    !Array.isArray(value.proposedParticipants) ||
    value.proposedParticipants.length !== input.participants.length ||
    !("internalPlayersCreated" in value) ||
    !Array.isArray(value.internalPlayersCreated) ||
    !("participantCreates" in value) ||
    typeof value.participantCreates !== "number" ||
    !("participantUpdates" in value) ||
    typeof value.participantUpdates !== "number" ||
    !("participantDeletes" in value) ||
    typeof value.participantDeletes !== "number"
  ) {
    return null;
  }
  return value as AdminVerifiedLineupPlan;
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
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [
        key,
        typeof item === "string" && /At$/.test(key)
          ? Timestamp.fromDate(new Date(item))
          : Array.isArray(item)
            ? item.map((entry) =>
                typeof entry === "object" && entry !== null
                  ? toDocument(entry)
                  : entry,
              )
            : typeof item === "object" && item !== null
              ? toDocument(item)
              : item,
      ]),
  );
}

function comparable(value: object): string {
  return JSON.stringify(toDocument(value));
}
