import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { manualVotingClosesAt } from "@/domain/manual-voting";
import type {
  CoachAssignment,
  ManualFinalWhistleAttestation,
  Match,
  MatchParticipant,
  VerifiedCoachAssignment,
  VerifiedLineupReconciliation,
  VerifiedLineupSnapshot,
} from "@/domain/models";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import {
  adminManualVotingAuditId,
  hashAdminManualVotingAction,
  type AdminManualVotingAction,
} from "@/lib/server/admin-manual-voting-action";

import { getServerFirestore } from "./server";

export interface AdminManualVotingInput extends AdminManualVotingAction {
  operatorId: string;
}

export interface AdminManualVotingPlan {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  providerStatus: Match["status"];
  openingMode: "manual";
  verificationSource: string;
  trustedPreviewAt: string;
  proposedOpensAt: string;
  proposedClosesAt: string;
  durationMinutes: number;
  verifiedStarterCount: number;
  confirmedSubstituteCount: number;
  excludedSubstituteCount: number;
  verifiedCoachId: string;
  reconciliationStatus?: VerifiedLineupReconciliation["status"];
}

export interface AdminManualVotingResult {
  plan: AdminManualVotingPlan;
  auditId: string;
  disposition: "committed" | "idempotent_retry";
}

export class AdminManualVotingRejectedError extends Error {}
export class AdminManualVotingCommitError extends Error {}

export class AdminManualVotingService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async preview(input: AdminManualVotingInput): Promise<AdminManualVotingPlan> {
    const result = await this.execute(input);
    if ("auditId" in result) throw new Error("Unexpected audit receipt.");
    return result;
  }

  async applyAuthorized(
    input: AdminManualVotingInput,
    challengeToken: string | undefined,
  ): Promise<AdminManualVotingResult> {
    if (!challengeToken || challengeToken.length > 256) {
      throw new AdminManualVotingRejectedError("Invalid challenge.");
    }
    try {
      const result = await this.execute(input, challengeToken);
      if (!("auditId" in result)) throw new Error("Missing audit receipt.");
      return result;
    } catch (error) {
      if (error instanceof AdminManualVotingRejectedError) throw error;
      throw new AdminManualVotingCommitError();
    }
  }

  private async execute(
    input: AdminManualVotingInput,
    challengeToken?: string,
  ): Promise<AdminManualVotingPlan | AdminManualVotingResult> {
    validateInput(input);
    const challengeId = challengeToken
      ? adminChallengeDocumentId(challengeToken)
      : undefined;
    const auditId = challengeId
      ? adminManualVotingAuditId(challengeId)
      : undefined;
    const actionHash = hashAdminManualVotingAction(input);

    return this.database.runTransaction(async (transaction) => {
      const matchReference = this.database.doc(`matches/${input.matchId}`);
      const lineupReference = this.database.doc(
        `matches/${input.matchId}/verifiedLineups/current`,
      );
      const verifiedCoachReference = this.database.doc(
        `matches/${input.matchId}/verifiedCoachAssignments/head-coach`,
      );
      const coachReference = this.database.doc(
        `matches/${input.matchId}/coachAssignments/head-coach`,
      );
      const reconciliationReference = this.database.doc(
        `matches/${input.matchId}/lineupReconciliations/provider`,
      );
      const attestationReference = this.database.doc(
        `matches/${input.matchId}/finalWhistleAttestations/manual`,
      );
      const resultReference = this.database.doc(
        `matches/${input.matchId}/results/summary`,
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
          throw new AdminManualVotingRejectedError("Invalid challenge.");
        }
        if (challenge.consumedAt !== undefined) {
          const auditSnapshot = await transaction.get(auditReference);
          const audit = auditSnapshot.data();
          if (
            challenge.committedAuditId !== auditId ||
            audit?.action !== "manual_voting_apply" ||
            audit.operatorUid !== input.operatorId ||
            audit.actionHash !== actionHash ||
            audit.outcome !== "success"
          ) {
            throw new AdminManualVotingRejectedError("Invalid receipt.");
          }
          return {
            plan: audit.plan as AdminManualVotingPlan,
            auditId,
            disposition: "idempotent_retry",
          };
        }
        if (
          challenge.expiresAt.toMillis() <=
          challengeSnapshot.readTime.toMillis()
        ) {
          throw new AdminManualVotingRejectedError("Expired challenge.");
        }
      }

      const [
        matchSnapshot,
        lineupSnapshot,
        verifiedCoachSnapshot,
        coachSnapshot,
        reconciliationSnapshot,
        attestationSnapshot,
        resultSnapshot,
        participantsSnapshot,
        ballots,
        revisions,
      ] = await Promise.all([
        transaction.get(matchReference),
        transaction.get(lineupReference),
        transaction.get(verifiedCoachReference),
        transaction.get(coachReference),
        transaction.get(reconciliationReference),
        transaction.get(attestationReference),
        transaction.get(resultReference),
        transaction.get(participantCollection),
        transaction.get(ballotQuery),
        transaction.get(revisionQuery),
      ]);
      if (!matchSnapshot.exists) {
        throw new AdminManualVotingRejectedError("Match was not found.");
      }
      const match = fromSnapshot<Match>(matchSnapshot);
      if (
        match.trackedTeamId !== input.trackedTeamId ||
        match.externalProviderFixtureId !== input.externalFixtureId
      ) {
        throw new AdminManualVotingRejectedError("Match binding is invalid.");
      }
      if (
        !["not_ready", "preparing_rating"].includes(match.ratingState) ||
        resultSnapshot.exists ||
        !ballots.empty ||
        !revisions.empty ||
        attestationSnapshot.exists
      ) {
        throw new AdminManualVotingRejectedError(
          "Voting cannot be opened in the current state.",
        );
      }
      if (!lineupSnapshot.exists) {
        throw new AdminManualVotingRejectedError(
          "A verified lineup is required.",
        );
      }
      const lineup = fromSnapshot<VerifiedLineupSnapshot>(lineupSnapshot);
      requireBinding(lineup, input);
      if (lineup.provenance !== "operator_verified") {
        throw new AdminManualVotingRejectedError(
          "An operator-verified lineup is required.",
        );
      }
      const reconciliation = reconciliationSnapshot.exists
        ? fromSnapshot<VerifiedLineupReconciliation>(reconciliationSnapshot)
        : undefined;
      if (reconciliation?.status === "conflict") {
        throw new AdminManualVotingRejectedError(
          "A material lineup conflict requires review.",
        );
      }
      const ids = lineup.participants.map(({ playerId }) => playerId);
      if (new Set(ids).size !== ids.length) {
        throw new AdminManualVotingRejectedError(
          "Canonical Player identities conflict.",
        );
      }
      const starters = lineup.participants.filter(
        (participant) =>
          participant.squadRole === "starter" &&
          participant.participationStatus === "confirmed_starter" &&
          participant.participated === true,
      );
      const confirmedSubstitutes = lineup.participants.filter(
        (participant) =>
          participant.squadRole === "substitute" &&
          participant.participationStatus === "confirmed_substitute" &&
          participant.participated === true,
      );
      const excludedSubstitutes = lineup.participants.filter(
        (participant) =>
          participant.squadRole === "substitute" &&
          participant.participated === false &&
          ["unused_substitute", "unconfirmed"].includes(
            participant.participationStatus,
          ),
      );
      if (
        starters.length !== 11 ||
        starters.length +
          confirmedSubstitutes.length +
          excludedSubstitutes.length !==
          lineup.participants.length
      ) {
        throw new AdminManualVotingRejectedError(
          "Verified participant eligibility is incomplete.",
        );
      }
      const playerSnapshots = await Promise.all(
        ids.map((id) => transaction.get(this.database.doc(`players/${id}`))),
      );
      if (playerSnapshots.some((snapshot) => !snapshot.exists)) {
        throw new AdminManualVotingRejectedError(
          "A canonical Player identity is missing.",
        );
      }
      const materialized = new Map(
        participantsSnapshot.docs.map((document) => [
          document.id,
          fromSnapshot<MatchParticipant>(document),
        ]),
      );
      if (
        lineup.participants.some((participant) => {
          const current = materialized.get(participant.playerId);
          return (
            current?.teamId !== input.trackedTeamId ||
            current.participated !== participant.participated ||
            current.squadRole !== participant.squadRole ||
            current.participationStatus !== participant.participationStatus
          );
        })
      ) {
        throw new AdminManualVotingRejectedError(
          "Verified lineup materialization is incomplete.",
        );
      }
      if (!verifiedCoachSnapshot.exists || !coachSnapshot.exists) {
        throw new AdminManualVotingRejectedError(
          "A verified head coach is required.",
        );
      }
      const verifiedCoach = fromSnapshot<VerifiedCoachAssignment>(
        verifiedCoachSnapshot,
      );
      const coach = fromSnapshot<CoachAssignment>(coachSnapshot);
      requireBinding(verifiedCoach, input);
      if (
        verifiedCoach.provenance !== "operator_verified" ||
        coach.matchId !== input.matchId ||
        coach.teamId !== input.trackedTeamId ||
        coach.coachId !== verifiedCoach.coachId ||
        coach.provenance !== "operator_verified"
      ) {
        throw new AdminManualVotingRejectedError(
          "Verified head coach materialization is invalid.",
        );
      }

      const trustedAt = matchSnapshot.readTime.toDate();
      let closesAt: Date;
      try {
        closesAt = manualVotingClosesAt(
          trustedAt,
          input.closeMode,
          input.customClosesAtLocal,
        );
      } catch (error) {
        throw new AdminManualVotingRejectedError(
          error instanceof Error ? error.message : "Invalid close time.",
        );
      }
      const plan: AdminManualVotingPlan = {
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: input.externalFixtureId,
        providerStatus: match.status,
        openingMode: "manual",
        verificationSource: input.verificationSource,
        trustedPreviewAt: trustedAt.toISOString(),
        proposedOpensAt: trustedAt.toISOString(),
        proposedClosesAt: closesAt.toISOString(),
        durationMinutes: Math.round(
          (closesAt.getTime() - trustedAt.getTime()) / 60_000,
        ),
        verifiedStarterCount: starters.length,
        confirmedSubstituteCount: confirmedSubstitutes.length,
        excludedSubstituteCount: excludedSubstitutes.length,
        verifiedCoachId: coach.coachId,
        ...(reconciliation
          ? { reconciliationStatus: reconciliation.status }
          : {}),
      };
      if (!challengeReference || !auditReference || !auditId) return plan;

      const attestation: ManualFinalWhistleAttestation = {
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: input.externalFixtureId,
        operatorId: input.operatorId,
        actualMatchEnded: true,
        verificationSource: input.verificationSource,
        verificationReason: input.verificationReason,
        providerStatusObserved: match.status,
        provenance: "operator_verified",
        attestedAt: trustedAt.toISOString(),
        createdAt: trustedAt.toISOString(),
      };
      transaction.create(attestationReference, toDocument(attestation));
      transaction.update(matchReference, {
        ratingState: "rating_ready",
        ratingReadyAt: Timestamp.fromDate(trustedAt),
        votingOpensAt: Timestamp.fromDate(trustedAt),
        votingClosesAt: Timestamp.fromDate(closesAt),
        votingOpeningMode: "manual",
        manualFinalWhistleAttestedAt: Timestamp.fromDate(trustedAt),
        votingOpenNotificationWindow: 0,
        votingOpenNotificationStatus: "pending",
        updatedAt: Timestamp.fromDate(trustedAt),
      });
      transaction.update(challengeReference, {
        consumedAt: Timestamp.fromDate(trustedAt),
        committedAuditId: auditId,
      });
      transaction.create(auditReference, {
        operatorUid: input.operatorId,
        action: "manual_voting_apply",
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: input.externalFixtureId,
        evidenceReference: input.verificationSource,
        verificationReason: input.verificationReason,
        actionHash,
        outcome: "success",
        commitDisposition: "committed",
        plan,
        createdAt: Timestamp.fromDate(trustedAt),
      });
      return { plan, auditId, disposition: "committed" };
    });
  }
}

function validateInput(input: AdminManualVotingInput) {
  if (
    input.finalWhistleConfirmed !== true ||
    !/^https:\/\//i.test(input.verificationSource) ||
    input.verificationReason.trim().length < 10 ||
    !["default", "custom"].includes(input.closeMode)
  ) {
    throw new AdminManualVotingRejectedError("Manual voting input is invalid.");
  }
}

function requireBinding(
  evidence: {
    matchId: string;
    trackedTeamId: string;
    externalFixtureId: string;
  },
  input: AdminManualVotingInput,
) {
  if (
    evidence.matchId !== input.matchId ||
    evidence.trackedTeamId !== input.trackedTeamId ||
    evidence.externalFixtureId !== input.externalFixtureId
  ) {
    throw new AdminManualVotingRejectedError("Evidence binding is invalid.");
  }
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
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" && /At$/.test(key)
        ? Timestamp.fromDate(new Date(item))
        : item,
    ]),
  );
}
