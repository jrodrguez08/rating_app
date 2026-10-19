import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import { playerProviderAliasTransition } from "@/application/reconcile-player-identities";
import { mergeTeamPlayerMembership } from "@/application/team-player-membership";
import type {
  AdminLineupDraft,
  Match,
  MatchParticipant,
  MatchResult,
  Player,
  PlayerIdentityReview,
  PlayerProviderAlias,
  TeamPlayerMembership,
} from "@/domain/models";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";
import {
  normalizePlayerSearch,
  playerSearchPrefixes,
} from "@/domain/player-search";
import { hashAdminLineupDraft } from "@/lib/server/admin-lineup-draft-action";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import {
  adminPlayerIdentityAuditId,
  adminPlayerIdentityResourceId,
  hashAdminPlayerIdentityAction,
  playerIdentityReviewId,
  type AdminPlayerIdentityAction,
} from "@/lib/server/admin-player-identity-action";

import { getServerFirestore } from "./server";

const MAX_IDENTITY_MATCHES = 100;
const MAX_OWNER_DRAFTS = 20;
const MAX_TEAM_RESULTS = 500;

export interface AdminPlayerIdentityInput extends AdminPlayerIdentityAction {
  operatorId: string;
}

export interface AdminPlayerIdentityPlan {
  decision: "match" | "nonmatch";
  canonical: IdentityEvidence;
  provider: IdentityEvidence;
  currentAliasTarget?: string;
  previousReview?: "active" | "corrected";
  proposedChanges: string[];
  preservedReferences: {
    canonicalParticipations: number;
    providerParticipations: number;
    verifiedLineups: number;
    ownerDrafts: number;
    canonicalPublishedResults: number;
    providerPublishedResults: number;
  };
  warnings: string[];
}

interface IdentityEvidence {
  playerId: string;
  name?: string;
  externalProviderId?: string;
  currentTeamId?: string;
  position?: Player["position"];
  shirtNumber?: number;
  identityProvenance?: Player["identityProvenance"];
  matchIds: string[];
}

export interface AdminPlayerIdentityResult {
  plan: AdminPlayerIdentityPlan;
  auditId: string;
  disposition: "committed" | "idempotent_retry";
}

export class AdminPlayerIdentityRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminPlayerIdentityRejectedError";
  }
}

export class AdminPlayerIdentityCommitError extends Error {
  constructor() {
    super("Player identity reconciliation commit failed.");
    this.name = "AdminPlayerIdentityCommitError";
  }
}

export class AdminPlayerIdentityService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async preview(
    input: AdminPlayerIdentityInput,
  ): Promise<AdminPlayerIdentityPlan> {
    const result = await this.execute(input);
    if ("auditId" in result) throw new Error("Unexpected audit receipt.");
    return result;
  }

  async applyAuthorized(
    input: AdminPlayerIdentityInput,
    challengeToken: string | undefined,
  ): Promise<AdminPlayerIdentityResult> {
    if (!challengeToken || challengeToken.length > 256) {
      throw new AdminPlayerIdentityRejectedError(
        "Admin action challenge is invalid.",
      );
    }
    try {
      const result = await this.execute(input, challengeToken);
      if (!("auditId" in result)) throw new Error("Audit receipt is missing.");
      return result;
    } catch (error) {
      if (error instanceof AdminPlayerIdentityRejectedError) throw error;
      throw new AdminPlayerIdentityCommitError();
    }
  }

  private async execute(
    input: AdminPlayerIdentityInput,
    challengeToken?: string,
  ): Promise<AdminPlayerIdentityPlan | AdminPlayerIdentityResult> {
    validateInput(input);
    const providerPlayerId = providerEntityId(
      "player",
      input.externalProvider,
      input.externalProviderPlayerId,
    );
    if (providerPlayerId === input.canonicalPlayerId) {
      throw new AdminPlayerIdentityRejectedError(
        "The selected identities are already the same Player.",
      );
    }
    const aliasId = playerProviderAliasId(
      input.externalProvider,
      input.externalProviderPlayerId,
    );
    const reviewId = playerIdentityReviewId(
      input.canonicalPlayerId,
      input.externalProvider,
      input.externalProviderPlayerId,
    );
    const challengeId = challengeToken
      ? adminChallengeDocumentId(challengeToken)
      : undefined;
    const auditId = challengeId
      ? adminPlayerIdentityAuditId(challengeId)
      : undefined;
    const actionHash = hashAdminPlayerIdentityAction(input);

    return this.database.runTransaction(async (transaction) => {
      const canonicalReference = this.database.doc(
        `players/${input.canonicalPlayerId}`,
      );
      const providerReference = this.database.doc(
        `players/${providerPlayerId}`,
      );
      const aliasReference = this.database.doc(
        `playerProviderAliases/${aliasId}`,
      );
      const canonicalMembershipReference = this.database.doc(
        `teams/${input.trackedTeamId}/playerMemberships/${input.canonicalPlayerId}`,
      );
      const providerMembershipReference = this.database.doc(
        `teams/${input.trackedTeamId}/playerMemberships/${providerPlayerId}`,
      );
      const reviewReference = this.database.doc(
        `playerIdentityReviews/${reviewId}`,
      );
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
          challenge.resourceId !== adminPlayerIdentityResourceId(input) ||
          challenge.actionHash !== actionHash ||
          !(challenge.expiresAt instanceof Timestamp)
        ) {
          throw new AdminPlayerIdentityRejectedError(
            "Admin action challenge is invalid.",
          );
        }
        if (challenge.consumedAt !== undefined) {
          const auditSnapshot = await transaction.get(auditReference);
          const audit = auditSnapshot.data();
          if (
            !(challenge.consumedAt instanceof Timestamp) ||
            challenge.committedAuditId !== auditId ||
            !auditSnapshot.exists ||
            audit?.operatorUid !== input.operatorId ||
            audit.action !== "player_identity_apply" ||
            audit.resourceId !== adminPlayerIdentityResourceId(input) ||
            audit.actionHash !== actionHash ||
            audit.outcome !== "success" ||
            !isPlan(audit.plan)
          ) {
            throw new AdminPlayerIdentityRejectedError(
              "Committed admin action audit is invalid.",
            );
          }
          return {
            plan: audit.plan,
            auditId,
            disposition: "idempotent_retry" as const,
          };
        }
        if (
          challenge.committedAuditId !== undefined ||
          challenge.expiresAt.toMillis() <=
            challengeSnapshot.readTime.toMillis()
        ) {
          throw new AdminPlayerIdentityRejectedError(
            "Admin action challenge is invalid.",
          );
        }
      }

      const participantQuery = this.database
        .collectionGroup("participants")
        .where("playerId", "in", [input.canonicalPlayerId, providerPlayerId])
        .limit(MAX_IDENTITY_MATCHES * 2 + 1);
      const draftsQuery = this.database
        .collectionGroup("lineupDrafts")
        .where("ownerId", "==", input.operatorId)
        .limit(MAX_OWNER_DRAFTS + 1);
      const resultsQuery = this.database
        .collectionGroup("results")
        .where("teamId", "==", input.trackedTeamId)
        .limit(MAX_TEAM_RESULTS + 1);
      const inboundAliasesQuery = this.database
        .collection("playerProviderAliases")
        .where("canonicalPlayerId", "==", providerPlayerId)
        .limit(2);
      const [
        canonicalSnapshot,
        providerSnapshot,
        aliasSnapshot,
        canonicalMembershipSnapshot,
        providerMembershipSnapshot,
        reviewSnapshot,
        participantSnapshot,
        draftsSnapshot,
        resultsSnapshot,
        inboundAliasesSnapshot,
      ] = await Promise.all([
        transaction.get(canonicalReference),
        transaction.get(providerReference),
        transaction.get(aliasReference),
        transaction.get(canonicalMembershipReference),
        transaction.get(providerMembershipReference),
        transaction.get(reviewReference),
        transaction.get(participantQuery),
        transaction.get(draftsQuery),
        transaction.get(resultsQuery),
        transaction.get(inboundAliasesQuery),
      ]);
      if (
        participantSnapshot.size > MAX_IDENTITY_MATCHES * 2 ||
        draftsSnapshot.size > MAX_OWNER_DRAFTS ||
        resultsSnapshot.size > MAX_TEAM_RESULTS
      ) {
        throw new AdminPlayerIdentityRejectedError(
          "Identity history exceeds the reviewed reconciliation bound.",
        );
      }
      if (!canonicalSnapshot.exists) {
        throw new AdminPlayerIdentityRejectedError(
          "Canonical Player was not found.",
        );
      }
      const canonical = fromSnapshot<Player>(canonicalSnapshot);
      if (canonical.identityProvenance !== "operator_verified") {
        throw new AdminPlayerIdentityRejectedError(
          "The canonical survivor must be an operator-verified Player.",
        );
      }
      const provider = providerSnapshot.exists
        ? fromSnapshot<Player>(providerSnapshot)
        : undefined;
      if (
        provider &&
        (provider.externalProvider !== input.externalProvider ||
          provider.externalProviderId !== input.externalProviderPlayerId)
      ) {
        throw new AdminPlayerIdentityRejectedError(
          "Provider identity mapping conflicts with the selected Player.",
        );
      }
      const alias = aliasSnapshot.exists
        ? fromSnapshot<PlayerProviderAlias>(aliasSnapshot)
        : undefined;
      const proposedAlias: PlayerProviderAlias = {
        id: aliasId,
        canonicalPlayerId: canonical.id,
        canonicalExternalProviderPlayerId: input.externalProviderPlayerId,
        externalProvider: input.externalProvider,
        externalProviderPlayerId: input.externalProviderPlayerId,
        createdAt: canonicalSnapshot.readTime.toDate().toISOString(),
        updatedAt: canonicalSnapshot.readTime.toDate().toISOString(),
      };
      if (input.decision === "match") {
        try {
          playerProviderAliasTransition(alias, proposedAlias);
        } catch {
          throw new AdminPlayerIdentityRejectedError(
            "Player provider alias conflicts with another canonical identity.",
          );
        }
        if (
          !inboundAliasesSnapshot.empty &&
          inboundAliasesSnapshot.docs.some(
            (document) => document.id !== aliasId,
          )
        ) {
          throw new AdminPlayerIdentityRejectedError(
            "Provider identity has multi-hop aliases and cannot be reconciled.",
          );
        }
      } else if (alias && alias.canonicalPlayerId === canonical.id) {
        throw new AdminPlayerIdentityRejectedError(
          "A confirmed alias cannot be recorded as a nonmatch.",
        );
      }

      const participants = participantSnapshot.docs.map((document) =>
        fromSnapshot<MatchParticipant>(document),
      );
      const canonicalParticipants = participants.filter(
        ({ playerId }) => playerId === canonical.id,
      );
      const providerParticipants = participants.filter(
        ({ playerId }) => playerId === providerPlayerId,
      );
      const canonicalMembership = canonicalMembershipSnapshot.exists
        ? fromSnapshot<TeamPlayerMembership>(canonicalMembershipSnapshot)
        : undefined;
      const providerMembership = providerMembershipSnapshot.exists
        ? fromSnapshot<TeamPlayerMembership>(providerMembershipSnapshot)
        : undefined;
      const canonicalBelongs =
        canonical.currentTeamId === input.trackedTeamId ||
        canonicalMembership?.teamId === input.trackedTeamId ||
        canonicalParticipants.some(
          ({ teamId }) => teamId === input.trackedTeamId,
        );
      const providerBelongs =
        provider?.currentTeamId === input.trackedTeamId ||
        providerMembership?.teamId === input.trackedTeamId ||
        providerParticipants.some(
          ({ teamId }) => teamId === input.trackedTeamId,
        );
      const genuineProviderEvidence =
        provider !== undefined ||
        alias !== undefined ||
        providerParticipants.length > 0;
      if (!canonicalBelongs || !providerBelongs || !genuineProviderEvidence) {
        throw new AdminPlayerIdentityRejectedError(
          "Both identities require tracked-Team evidence.",
        );
      }
      if (
        providerParticipants.some(
          (participant) =>
            participant.externalProvider !== input.externalProvider ||
            participant.externalProviderPlayerId !==
              input.externalProviderPlayerId,
        )
      ) {
        throw new AdminPlayerIdentityRejectedError(
          "Provider participation evidence is ambiguous.",
        );
      }
      const sharedMatch = providerParticipants.find((providerParticipant) =>
        canonicalParticipants.some(
          (canonicalParticipant) =>
            canonicalParticipant.matchId === providerParticipant.matchId,
        ),
      );
      if (sharedMatch) {
        throw new AdminPlayerIdentityRejectedError(
          "Both identities already appear in the same Match.",
        );
      }

      const results = resultsSnapshot.docs.map((document) =>
        fromSnapshot<MatchResult>(document),
      );
      const providerPublishedResults = results.filter(
        (result) => providerPlayerId in result.playerResults,
      ).length;
      const canonicalPublishedResults = results.filter(
        (result) => canonical.id in result.playerResults,
      ).length;
      if (input.decision === "match" && providerPublishedResults > 0) {
        throw new AdminPlayerIdentityRejectedError(
          "Provider Player has immutable published results and cannot be linked automatically.",
        );
      }

      const relevantMatchIds = [
        ...new Set(providerParticipants.map(({ matchId }) => matchId)),
      ];
      const matchReferences = relevantMatchIds.map((matchId) =>
        this.database.doc(`matches/${matchId}`),
      );
      const verifiedReferences = relevantMatchIds.map((matchId) =>
        this.database.doc(`matches/${matchId}/verifiedLineups/current`),
      );
      const resultReferences = relevantMatchIds.map((matchId) =>
        this.database.doc(`matches/${matchId}/results/summary`),
      );
      const [matchSnapshots, verifiedSnapshots, protectedResultSnapshots] =
        relevantMatchIds.length === 0
          ? [[], [], []]
          : await Promise.all([
              transaction.getAll(...matchReferences),
              transaction.getAll(...verifiedReferences),
              transaction.getAll(...resultReferences),
            ]);
      const ballotSnapshots = await Promise.all(
        relevantMatchIds.map((matchId) =>
          transaction.get(
            this.database.collection(`matches/${matchId}/ballots`).limit(1),
          ),
        ),
      );
      if (
        input.decision === "match" &&
        (matchSnapshots.some(
          (snapshot) =>
            snapshot.exists &&
            ["rating_ready", "rating_closed"].includes(
              fromSnapshot<Match>(snapshot).ratingState,
            ),
        ) ||
          protectedResultSnapshots.some((snapshot) => snapshot.exists) ||
          ballotSnapshots.some((snapshot) => !snapshot.empty))
      ) {
        throw new AdminPlayerIdentityRejectedError(
          "Provider Player has protected voting history and cannot be linked automatically.",
        );
      }

      const affectedDrafts = draftsSnapshot.docs
        .map((document) => ({
          document,
          draft: fromSnapshot<AdminLineupDraft>(document),
        }))
        .filter(({ draft }) =>
          draft.participants.some(
            ({ playerId }) => playerId === providerPlayerId,
          ),
        );
      for (const { draft } of affectedDrafts) {
        if (
          draft.participants.some(({ playerId }) => playerId === canonical.id)
        ) {
          throw new AdminPlayerIdentityRejectedError(
            "A saved draft already contains both identities.",
          );
        }
      }

      const verifiedLineups = verifiedSnapshots.filter((snapshot) =>
        snapshot.exists
          ? Array.isArray(snapshot.data()?.participants) &&
            snapshot
              .data()!
              .participants.some(
                (participant: unknown) =>
                  isRecord(participant) &&
                  participant.playerId === providerPlayerId,
              )
          : false,
      ).length;
      const previousReview = reviewSnapshot.exists
        ? fromSnapshot<PlayerIdentityReview>(reviewSnapshot)
        : undefined;
      const warnings = [
        ...(canonical.displayName === provider?.displayName
          ? ["Los nombres coinciden, pero el nombre no demuestra identidad."]
          : ["Los nombres difieren; revise la evidencia independiente."]),
        ...(provider
          ? []
          : ["No existe todavía un documento Player del proveedor."]),
        ...(verifiedLineups > 0
          ? [
              "Las alineaciones verificadas históricas se conservarán sin cambios.",
            ]
          : []),
      ];
      const proposedChanges =
        input.decision === "nonmatch"
          ? ["Registrar la decisión revisada de que no son la misma persona."]
          : [
              `Asignar ${aliasId} a ${canonical.id}.`,
              "Conservar ambos documentos Player y todas las referencias históricas.",
              ...(affectedDrafts.length > 0
                ? [
                    `Actualizar ${affectedDrafts.length} borrador(es) del propietario a la identidad canónica.`,
                  ]
                : []),
              "Actualizar la afiliación canónica del equipo.",
            ];
      const plan: AdminPlayerIdentityPlan = {
        decision: input.decision,
        canonical: evidence(
          canonical,
          canonicalMembership,
          canonicalParticipants,
        ),
        provider: evidence(
          provider ?? {
            id: providerPlayerId,
            displayName:
              providerParticipants[0]?.playerName ?? "Identidad del proveedor",
            externalProvider: input.externalProvider,
            externalProviderId: input.externalProviderPlayerId,
            createdAt: canonical.createdAt,
            updatedAt: canonical.updatedAt,
          },
          providerMembership,
          providerParticipants,
        ),
        ...(alias ? { currentAliasTarget: alias.canonicalPlayerId } : {}),
        ...(previousReview ? { previousReview: previousReview.status } : {}),
        proposedChanges,
        preservedReferences: {
          canonicalParticipations: canonicalParticipants.length,
          providerParticipations: providerParticipants.length,
          verifiedLineups,
          ownerDrafts: affectedDrafts.length,
          canonicalPublishedResults,
          providerPublishedResults,
        },
        warnings,
      };
      if (!challengeReference || !auditReference || !auditId) return plan;

      const timestamp = canonicalSnapshot.readTime.toDate().toISOString();
      if (input.decision === "match") {
        transaction.set(
          aliasReference,
          toDocument({
            ...proposedAlias,
            createdAt: alias?.createdAt ?? timestamp,
            updatedAt: timestamp,
          }),
        );
        transaction.update(canonicalReference, {
          externalProvider: input.externalProvider,
          externalProviderId: input.externalProviderPlayerId,
          updatedAt: Timestamp.fromDate(new Date(timestamp)),
        });
        const incomingMembership: TeamPlayerMembership = {
          playerId: canonical.id,
          teamId: input.trackedTeamId,
          displayName: canonical.displayName,
          searchName: normalizePlayerSearch(canonical.displayName),
          searchPrefixes: [
            ...new Set([
              ...playerSearchPrefixes(canonical.displayName),
              ...(providerMembership?.searchPrefixes ?? []),
              ...(provider ? playerSearchPrefixes(provider.displayName) : []),
            ]),
          ],
          source: "operator_verified",
          ...(providerMembership?.shirtNumber === undefined
            ? {}
            : { shirtNumber: providerMembership.shirtNumber }),
          firstObservedAt:
            canonicalMembership?.firstObservedAt ??
            providerMembership?.firstObservedAt ??
            timestamp,
          lastObservedAt: timestamp,
          createdAt: canonicalMembership?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        transaction.set(
          canonicalMembershipReference,
          toDocument(
            mergeTeamPlayerMembership(canonicalMembership, incomingMembership),
          ),
        );
        for (const { document, draft } of affectedDrafts) {
          const participants = draft.participants.map((participant) =>
            participant.playerId === providerPlayerId
              ? canonicalizeDraftParticipant(participant, canonical)
              : participant,
          );
          const updatedDraft = {
            ...draft,
            participants,
            baseVersion: draft.version,
          };
          transaction.set(
            document.ref,
            toDocument({
              ...draft,
              participants,
              version: draft.version + 1,
              contentHash: hashAdminLineupDraft(updatedDraft),
              updatedAt: timestamp,
            }),
          );
        }
        if (previousReview?.status === "active") {
          transaction.update(reviewReference, {
            status: "corrected",
            correctedAt: Timestamp.fromDate(new Date(timestamp)),
            updatedAt: Timestamp.fromDate(new Date(timestamp)),
          });
        }
      } else {
        const review: PlayerIdentityReview = {
          id: reviewId,
          canonicalPlayerId: canonical.id,
          providerPlayerId,
          externalProvider: input.externalProvider,
          externalProviderPlayerId: input.externalProviderPlayerId,
          decision: "nonmatch",
          status: "active",
          verificationSource: input.verificationSource,
          verificationReason: input.verificationReason,
          operatorId: input.operatorId,
          reviewedAt: timestamp,
          createdAt: previousReview?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        transaction.set(reviewReference, toDocument(review));
      }
      transaction.update(challengeReference, {
        consumedAt: Timestamp.fromDate(new Date(timestamp)),
        committedAuditId: auditId,
      });
      transaction.create(auditReference, {
        operatorUid: input.operatorId,
        action: "player_identity_apply",
        resourceId: adminPlayerIdentityResourceId(input),
        canonicalPlayerId: canonical.id,
        providerPlayerId,
        decision: input.decision,
        evidenceReference: input.verificationSource,
        verificationReason: input.verificationReason,
        actionHash,
        outcome: "success",
        commitDisposition: "committed",
        plan: toDocument(plan),
        createdAt: Timestamp.fromDate(new Date(timestamp)),
      });
      return { plan, auditId, disposition: "committed" as const };
    });
  }
}

function validateInput(input: AdminPlayerIdentityInput): void {
  if (
    !/^player-internal-[a-f0-9]{32}$/.test(input.canonicalPlayerId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.trackedTeamId) ||
    input.externalProvider !== "api-football" ||
    !/^[1-9][0-9]{0,15}$/.test(input.externalProviderPlayerId) ||
    !["match", "nonmatch"].includes(input.decision) ||
    !/^[A-Za-z0-9_.@:-]{1,128}$/.test(input.operatorId) ||
    !validHttpsUrl(input.verificationSource) ||
    input.verificationReason.trim().length < 10 ||
    input.verificationReason.length > 500
  ) {
    throw new AdminPlayerIdentityRejectedError(
      "Player identity reconciliation input is invalid.",
    );
  }
}

function canonicalizeDraftParticipant(
  participant: AdminLineupDraft["participants"][number],
  canonical: Player,
): AdminLineupDraft["participants"][number] {
  const { identityAllocationToken, ...persisted } = participant;
  void identityAllocationToken;
  return {
    ...persisted,
    playerId: canonical.id,
    playerName: canonical.displayName,
    createInternalIdentity: false,
  };
}

function evidence(
  player: Player,
  membership: TeamPlayerMembership | undefined,
  participants: MatchParticipant[],
): IdentityEvidence {
  return {
    playerId: player.id,
    name: player.displayName,
    ...(player.externalProviderId
      ? { externalProviderId: player.externalProviderId }
      : {}),
    ...(player.currentTeamId ? { currentTeamId: player.currentTeamId } : {}),
    ...(player.position ? { position: player.position } : {}),
    ...(membership?.shirtNumber === undefined
      ? {}
      : { shirtNumber: membership.shirtNumber }),
    ...(player.identityProvenance
      ? { identityProvenance: player.identityProvenance }
      : {}),
    matchIds: [...new Set(participants.map(({ matchId }) => matchId))].sort(),
  };
}

function isPlan(value: unknown): value is AdminPlayerIdentityPlan {
  return (
    isRecord(value) &&
    ["match", "nonmatch"].includes(String(value.decision)) &&
    Array.isArray(value.proposedChanges) &&
    Array.isArray(value.warnings)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.username === "" && url.password === ""
    );
  } catch {
    return false;
  }
}

function fromSnapshot<T>(snapshot: {
  id: string;
  data(): DocumentData | undefined;
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

function toDocument<T>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key !== "id" && item !== undefined)
      .map(([key, item]) => [
        key,
        key.endsWith("At") && typeof item === "string"
          ? Timestamp.fromDate(new Date(item))
          : item,
      ]),
  );
}
