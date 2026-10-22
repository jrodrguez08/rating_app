import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import { playerProviderAliasTransition } from "@/application/reconcile-player-identities";
import { mergeTeamPlayerMembership } from "@/application/team-player-membership";
import { missingCanonicalPhotoUrl } from "@/domain/identity-photo";
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
import { playerProviderAliasId } from "@/domain/player-identity";
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
import { readIndexedTeamPlayers } from "./team-player-membership-index";

const MAX_IDENTITY_MATCHES = 100;
const MAX_OWNER_DRAFTS = 20;
const MAX_TEAM_RESULTS = 500;
const MAX_SUGGESTIONS = 12;
const MAX_SUGGESTION_REVIEW_CANDIDATES = 100;
const OWNER_IDENTITY_SOURCE = "authenticated-owner";
const OWNER_IDENTITY_REASON =
  "Player identity decision confirmed by the authenticated owner.";

export interface AdminPlayerIdentityInput extends AdminPlayerIdentityAction {
  operatorId: string;
}

export interface PlayerIdentityOption {
  id: string;
  name: string;
  position?: Player["position"];
  photoUrl?: string;
  shirtNumber?: number;
  identityProvenance: "provider" | "operator_verified";
}

export interface PlayerIdentitySuggestion {
  first: PlayerIdentityOption;
  second: PlayerIdentityOption;
  suggestedCanonicalPlayerId: string;
  signals: Array<"name" | "abbreviation" | "position" | "shirt">;
}

export interface PlayerIdentitySuggestionResult {
  suggestions: PlayerIdentitySuggestion[];
  providerDataAvailable: boolean;
}

export interface AdminPlayerIdentityPlan {
  decision: "match" | "nonmatch";
  status:
    | "safe"
    | "already_linked"
    | "confirmed_different"
    | "insufficient_evidence"
    | "history_conflict";
  canApply: boolean;
  explanation: string;
  canonical: IdentityEvidence;
  duplicate: IdentityEvidence;
  suggestedCanonicalPlayerId: string;
  currentAliasTarget?: string;
  previousReview?: "active" | "corrected";
  proposedChanges: string[];
  preservedReferences: {
    canonicalParticipations: number;
    duplicateParticipations: number;
    verifiedLineups: number;
    ownerDrafts: number;
    canonicalPublishedResults: number;
    duplicatePublishedResults: number;
  };
  warnings: string[];
}

export interface IdentityEvidence {
  playerId: string;
  name: string;
  currentTeamId?: string;
  position?: Player["position"];
  photoUrl?: string;
  shirtNumber?: number;
  identityProvenance: "provider" | "operator_verified";
  matchCount: number;
  hasProtectedHistory: boolean;
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
    super("No se pudo guardar la conciliación de jugadores.");
    this.name = "AdminPlayerIdentityCommitError";
  }
}

export class AdminPlayerIdentityService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async suggestions(
    trackedTeamId: string,
  ): Promise<PlayerIdentitySuggestionResult> {
    if (!validEntityId(trackedTeamId)) {
      throw new AdminPlayerIdentityRejectedError("El equipo no es válido.");
    }
    const indexed = await readIndexedTeamPlayers(this.database, trackedTeamId);
    const manual = indexed.players.filter(
      ({ player }) =>
        player.identityProvenance === "operator_verified" ||
        (!player.externalProvider && !player.externalProviderId),
    );
    const provider = indexed.players.filter(
      ({ player }) =>
        player.externalProvider === "api-football" &&
        player.externalProviderId !== undefined,
    );
    const candidates = manual
      .flatMap((manualEntry) =>
        provider.flatMap((providerEntry) => {
          const signals = suggestionSignals(
            manualEntry.player,
            manualEntry.membership,
            providerEntry.player,
            providerEntry.membership,
          );
          if (!signals.includes("name") && !signals.includes("abbreviation")) {
            return [];
          }
          return [
            {
              first: option(manualEntry.player, manualEntry.membership),
              second: option(providerEntry.player, providerEntry.membership),
              suggestedCanonicalPlayerId: manualEntry.player.id,
              signals,
              score:
                (signals.includes("name") ? 8 : 5) +
                (signals.includes("position") ? 2 : 0) +
                (signals.includes("shirt") ? 2 : 0),
            },
          ];
        }),
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.first.name.localeCompare(right.first.name, "es"),
      )
      .slice(0, MAX_SUGGESTION_REVIEW_CANDIDATES);
    const reviewIds = candidates.map(({ first, second }) =>
      playerIdentityReviewId(first.id, second.id),
    );
    const reviewed = new Set<string>();
    for (let offset = 0; offset < reviewIds.length; offset += 100) {
      const references = reviewIds
        .slice(offset, offset + 100)
        .map((id) => this.database.doc(`playerIdentityReviews/${id}`));
      if (references.length === 0) continue;
      const snapshots = await this.database.getAll(...references);
      for (const snapshot of snapshots) {
        if (snapshot.exists && snapshot.data()?.status === "active") {
          reviewed.add(snapshot.id);
        }
      }
    }
    return {
      providerDataAvailable: provider.length > 0,
      suggestions: candidates
        .filter(
          ({ first, second }) =>
            !reviewed.has(playerIdentityReviewId(first.id, second.id)),
        )
        .slice(0, MAX_SUGGESTIONS)
        .map(({ first, second, suggestedCanonicalPlayerId, signals }) => ({
          first,
          second,
          suggestedCanonicalPlayerId,
          signals,
        })),
    };
  }

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
        "La autorización de esta acción no es válida.",
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
    const playerIds = [input.firstPlayerId, input.secondPlayerId] as const;
    if (playerIds[0] === playerIds[1]) {
      throw new AdminPlayerIdentityRejectedError(
        "Seleccione dos jugadores diferentes.",
      );
    }
    if (!playerIds.includes(input.canonicalPlayerId)) {
      throw new AdminPlayerIdentityRejectedError(
        "Seleccione cuál identidad desea conservar.",
      );
    }
    const duplicatePlayerId =
      playerIds[0] === input.canonicalPlayerId ? playerIds[1] : playerIds[0];
    const reviewId = playerIdentityReviewId(playerIds[0], playerIds[1]);
    const challengeId = challengeToken
      ? adminChallengeDocumentId(challengeToken)
      : undefined;
    const auditId = challengeId
      ? adminPlayerIdentityAuditId(challengeId)
      : undefined;
    const actionHash = hashAdminPlayerIdentityAction(input);

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
          challenge.resourceId !== adminPlayerIdentityResourceId(input) ||
          challenge.actionHash !== actionHash ||
          !(challenge.expiresAt instanceof Timestamp)
        ) {
          throw new AdminPlayerIdentityRejectedError(
            "La autorización de esta acción no es válida.",
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
              "El recibo de la conciliación no es válido.",
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
            "La autorización de esta acción venció.",
          );
        }
      }

      const playerReferences = playerIds.map((playerId) =>
        this.database.doc(`players/${playerId}`),
      );
      const membershipReferences = playerIds.map((playerId) =>
        this.database.doc(
          `teams/${input.trackedTeamId}/playerMemberships/${playerId}`,
        ),
      );
      const reviewReference = this.database.doc(
        `playerIdentityReviews/${reviewId}`,
      );
      const participantQuery = this.database
        .collectionGroup("participants")
        .where("playerId", "in", [...playerIds])
        .limit(MAX_IDENTITY_MATCHES * 2 + 1);
      const draftsQuery = this.database
        .collectionGroup("lineupDrafts")
        .where("ownerId", "==", input.operatorId)
        .limit(MAX_OWNER_DRAFTS + 1);
      const resultsQuery = this.database
        .collectionGroup("results")
        .where("teamId", "==", input.trackedTeamId)
        .limit(MAX_TEAM_RESULTS + 1);
      const [
        playerSnapshots,
        membershipSnapshots,
        reviewSnapshot,
        participantSnapshot,
        draftsSnapshot,
        resultsSnapshot,
      ] = await Promise.all([
        transaction.getAll(...playerReferences),
        transaction.getAll(...membershipReferences),
        transaction.get(reviewReference),
        transaction.get(participantQuery),
        transaction.get(draftsQuery),
        transaction.get(resultsQuery),
      ]);
      if (
        participantSnapshot.size > MAX_IDENTITY_MATCHES * 2 ||
        draftsSnapshot.size > MAX_OWNER_DRAFTS ||
        resultsSnapshot.size > MAX_TEAM_RESULTS
      ) {
        throw new AdminPlayerIdentityRejectedError(
          "El historial supera el límite seguro de conciliación.",
        );
      }
      if (playerSnapshots.some((snapshot) => !snapshot.exists)) {
        throw new AdminPlayerIdentityRejectedError(
          "Uno de los jugadores seleccionados ya no existe.",
        );
      }
      const players = playerSnapshots.map((snapshot) =>
        fromSnapshot<Player>(snapshot),
      );
      const memberships = membershipSnapshots.map((snapshot) =>
        snapshot.exists
          ? fromSnapshot<TeamPlayerMembership>(snapshot)
          : undefined,
      );
      const canonicalIndex = playerIds.indexOf(input.canonicalPlayerId);
      const duplicateIndex = canonicalIndex === 0 ? 1 : 0;
      const canonical = players[canonicalIndex];
      const duplicate = players[duplicateIndex];
      const canonicalMembership = memberships[canonicalIndex];
      const duplicateMembership = memberships[duplicateIndex];
      const participants = participantSnapshot.docs.map((document) =>
        fromSnapshot<MatchParticipant>(document),
      );
      const canonicalParticipants = participants.filter(
        ({ playerId }) => playerId === canonical.id,
      );
      const duplicateParticipants = participants.filter(
        ({ playerId }) => playerId === duplicate.id,
      );
      if (
        !belongsToTeam(
          canonical,
          canonicalMembership,
          canonicalParticipants,
          input.trackedTeamId,
        ) ||
        !belongsToTeam(
          duplicate,
          duplicateMembership,
          duplicateParticipants,
          input.trackedTeamId,
        )
      ) {
        throw new AdminPlayerIdentityRejectedError(
          "Ambos jugadores deben pertenecer al equipo seleccionado.",
        );
      }
      if (
        canonicalParticipants.some((participant) =>
          duplicateParticipants.some(
            (candidate) => candidate.matchId === participant.matchId,
          ),
        )
      ) {
        throw new AdminPlayerIdentityRejectedError(
          "Los dos jugadores aparecen en el mismo partido y requieren revisión especial.",
        );
      }

      const duplicateProvider = providerIdentity(duplicate);
      const aliasId = duplicateProvider
        ? playerProviderAliasId(
            duplicateProvider.provider,
            duplicateProvider.externalId,
          )
        : undefined;
      const aliasReference = aliasId
        ? this.database.doc(`playerProviderAliases/${aliasId}`)
        : undefined;
      const inboundAliasesQuery = this.database
        .collection("playerProviderAliases")
        .where("canonicalPlayerId", "==", duplicate.id)
        .limit(2);
      const [aliasSnapshot, inboundAliasesSnapshot] = await Promise.all([
        aliasReference ? transaction.get(aliasReference) : undefined,
        transaction.get(inboundAliasesQuery),
      ]);
      const alias = aliasSnapshot?.exists
        ? fromSnapshot<PlayerProviderAlias>(aliasSnapshot)
        : undefined;
      const canonicalProvider = providerIdentity(canonical);
      const pairAlreadyLinked =
        alias?.canonicalPlayerId === canonical.id ||
        (canonicalProvider !== undefined &&
          inboundAliasesSnapshot.docs.some((document) => {
            const inbound = fromSnapshot<PlayerProviderAlias>(document);
            return (
              inbound.externalProvider === canonicalProvider.provider &&
              inbound.externalProviderPlayerId === canonicalProvider.externalId
            );
          }));
      const proposedAlias =
        duplicateProvider && aliasId
          ? buildAlias(
              aliasId,
              canonical,
              duplicateProvider,
              playerSnapshots[0],
            )
          : undefined;
      const previousReview = reviewSnapshot.exists
        ? fromSnapshot<PlayerIdentityReview>(reviewSnapshot)
        : undefined;

      const results = resultsSnapshot.docs.map((document) =>
        fromSnapshot<MatchResult>(document),
      );
      const canonicalPublishedResults = resultCount(results, canonical.id);
      const duplicatePublishedResults = resultCount(results, duplicate.id);
      const matchIds = [...new Set(participants.map(({ matchId }) => matchId))];
      const [matchSnapshots, verifiedSnapshots, resultSnapshots] =
        matchIds.length === 0
          ? [[], [], []]
          : await Promise.all([
              transaction.getAll(
                ...matchIds.map((id) => this.database.doc(`matches/${id}`)),
              ),
              transaction.getAll(
                ...matchIds.map((id) =>
                  this.database.doc(`matches/${id}/verifiedLineups/current`),
                ),
              ),
              transaction.getAll(
                ...matchIds.map((id) =>
                  this.database.doc(`matches/${id}/results/summary`),
                ),
              ),
            ]);
      const ballotSnapshots = await Promise.all(
        matchIds.map((id) =>
          transaction.get(
            this.database.collection(`matches/${id}/ballots`).limit(1),
          ),
        ),
      );
      const protectedMatches = new Set<string>();
      matchIds.forEach((id, index) => {
        const match = matchSnapshots[index]?.exists
          ? fromSnapshot<Match>(matchSnapshots[index])
          : undefined;
        if (
          (match &&
            ["rating_ready", "rating_closed"].includes(match.ratingState)) ||
          resultSnapshots[index]?.exists ||
          !ballotSnapshots[index]?.empty
        ) {
          protectedMatches.add(id);
        }
      });
      const canonicalProtected =
        canonicalPublishedResults > 0 ||
        canonicalParticipants.some(({ matchId }) =>
          protectedMatches.has(matchId),
        );
      const duplicateProtected =
        duplicatePublishedResults > 0 ||
        duplicateParticipants.some(({ matchId }) =>
          protectedMatches.has(matchId),
        );
      const affectedDrafts = draftsSnapshot.docs
        .map((document) => ({
          document,
          draft: fromSnapshot<AdminLineupDraft>(document),
        }))
        .filter(({ draft }) =>
          draft.participants.some(({ playerId }) => playerId === duplicate.id),
        );
      if (
        affectedDrafts.some(({ draft }) =>
          draft.participants.some(({ playerId }) => playerId === canonical.id),
        )
      ) {
        throw new AdminPlayerIdentityRejectedError(
          "Un borrador contiene ambos jugadores y requiere revisión.",
        );
      }
      const verifiedLineups = verifiedSnapshots.filter(
        (snapshot) =>
          snapshot.exists &&
          Array.isArray(snapshot.data()?.participants) &&
          snapshot
            .data()!
            .participants.some(
              (participant: unknown) =>
                isRecord(participant) && participant.playerId === duplicate.id,
            ),
      ).length;

      const plan = buildPlan({
        input,
        canonical,
        duplicate,
        canonicalMembership,
        duplicateMembership,
        canonicalParticipants,
        duplicateParticipants,
        canonicalPublishedResults,
        duplicatePublishedResults,
        canonicalProtected,
        duplicateProtected,
        affectedDrafts: affectedDrafts.length,
        verifiedLineups,
        alias,
        proposedAlias,
        previousReview,
        pairAlreadyLinked,
        hasInboundAliasConflict: inboundAliasesSnapshot.docs.some(
          (document) => document.id !== aliasId,
        ),
      });
      if (!challengeReference || !auditReference || !auditId) return plan;
      if (!plan.canApply) {
        throw new AdminPlayerIdentityRejectedError(plan.explanation);
      }

      const timestamp = playerSnapshots[0].readTime.toDate().toISOString();
      if (input.decision === "match") {
        if (!aliasReference || !proposedAlias || !duplicateProvider) {
          throw new AdminPlayerIdentityRejectedError(plan.explanation);
        }
        transaction.set(
          aliasReference,
          toDocument({
            ...proposedAlias,
            createdAt: alias?.createdAt ?? timestamp,
            updatedAt: timestamp,
          }),
        );
        const inheritedPhotoUrl = missingCanonicalPhotoUrl(
          canonical,
          duplicate,
        );
        const canonicalUpdate = {
          ...(inheritedPhotoUrl === undefined
            ? {}
            : { photoUrl: inheritedPhotoUrl }),
          ...(canonical.identityProvenance === "operator_verified" &&
          canonical.externalProviderId === undefined
            ? {
                externalProvider: duplicateProvider.provider,
                externalProviderId: duplicateProvider.externalId,
              }
            : {}),
        };
        if (Object.keys(canonicalUpdate).length > 0) {
          transaction.update(playerReferences[canonicalIndex], {
            ...canonicalUpdate,
            updatedAt: Timestamp.fromDate(new Date(timestamp)),
          });
        }
        const incomingMembership: TeamPlayerMembership = {
          playerId: canonical.id,
          teamId: input.trackedTeamId,
          displayName: canonical.displayName,
          searchName: normalizePlayerSearch(canonical.displayName),
          searchPrefixes: [
            ...new Set([
              ...playerSearchPrefixes(canonical.displayName),
              ...(duplicateMembership?.searchPrefixes ?? []),
              ...playerSearchPrefixes(duplicate.displayName),
            ]),
          ],
          source:
            canonical.identityProvenance === "operator_verified"
              ? "operator_verified"
              : "current_squad",
          ...(duplicateMembership?.shirtNumber === undefined
            ? {}
            : { shirtNumber: duplicateMembership.shirtNumber }),
          firstObservedAt:
            canonicalMembership?.firstObservedAt ??
            duplicateMembership?.firstObservedAt ??
            timestamp,
          lastObservedAt: timestamp,
          createdAt: canonicalMembership?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        transaction.set(
          membershipReferences[canonicalIndex],
          toDocument(
            mergeTeamPlayerMembership(canonicalMembership, incomingMembership),
          ),
        );
        for (const { document, draft } of affectedDrafts) {
          const draftParticipants = draft.participants.map((participant) =>
            participant.playerId === duplicate.id
              ? canonicalizeDraftParticipant(participant, canonical)
              : participant,
          );
          transaction.set(
            document.ref,
            toDocument({
              ...draft,
              participants: draftParticipants,
              version: draft.version + 1,
              contentHash: hashAdminLineupDraft({
                ...draft,
                participants: draftParticipants,
                baseVersion: draft.version,
              }),
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
        const orderedIds = [...playerIds].sort();
        const review: PlayerIdentityReview = {
          id: reviewId,
          firstPlayerId: orderedIds[0],
          secondPlayerId: orderedIds[1],
          trackedTeamId: input.trackedTeamId,
          canonicalPlayerId: canonical.id,
          ...(duplicateProvider
            ? {
                providerPlayerId: duplicate.id,
                externalProvider: duplicateProvider.provider,
                externalProviderPlayerId: duplicateProvider.externalId,
              }
            : {}),
          decision: "nonmatch",
          status: "active",
          verificationSource: OWNER_IDENTITY_SOURCE,
          verificationReason: OWNER_IDENTITY_REASON,
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
        firstPlayerId: input.firstPlayerId,
        secondPlayerId: input.secondPlayerId,
        canonicalPlayerId: canonical.id,
        duplicatePlayerId,
        decision: input.decision,
        evidenceReference: OWNER_IDENTITY_SOURCE,
        verificationReason: OWNER_IDENTITY_REASON,
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

function buildPlan({
  input,
  canonical,
  duplicate,
  canonicalMembership,
  duplicateMembership,
  canonicalParticipants,
  duplicateParticipants,
  canonicalPublishedResults,
  duplicatePublishedResults,
  canonicalProtected,
  duplicateProtected,
  affectedDrafts,
  verifiedLineups,
  alias,
  proposedAlias,
  previousReview,
  pairAlreadyLinked,
  hasInboundAliasConflict,
}: {
  input: AdminPlayerIdentityInput;
  canonical: Player;
  duplicate: Player;
  canonicalMembership?: TeamPlayerMembership;
  duplicateMembership?: TeamPlayerMembership;
  canonicalParticipants: MatchParticipant[];
  duplicateParticipants: MatchParticipant[];
  canonicalPublishedResults: number;
  duplicatePublishedResults: number;
  canonicalProtected: boolean;
  duplicateProtected: boolean;
  affectedDrafts: number;
  verifiedLineups: number;
  alias?: PlayerProviderAlias;
  proposedAlias?: PlayerProviderAlias;
  previousReview?: PlayerIdentityReview;
  pairAlreadyLinked: boolean;
  hasInboundAliasConflict: boolean;
}): AdminPlayerIdentityPlan {
  let status: AdminPlayerIdentityPlan["status"] = "safe";
  let explanation =
    input.decision === "match"
      ? "La identidad de API-Football se vinculará al jugador que decidió conservar."
      : "La pareja quedará marcada como jugadores diferentes.";
  if (input.decision === "nonmatch" && pairAlreadyLinked) {
    status = "already_linked";
    explanation = "Estos jugadores ya est\u00e1n conciliados.";
  } else if (
    input.decision === "nonmatch" &&
    previousReview?.status === "active"
  ) {
    status = "confirmed_different";
    explanation = "Esta pareja ya fue confirmada como jugadores diferentes.";
  } else if (input.decision === "match" && pairAlreadyLinked) {
    status = "already_linked";
    explanation = "Estos jugadores ya están conciliados.";
  } else if (
    input.decision === "match" &&
    (!proposedAlias || hasInboundAliasConflict)
  ) {
    status = "insufficient_evidence";
    explanation = proposedAlias
      ? "La identidad seleccionada tiene enlaces incompatibles y requiere revisión especial."
      : "La identidad que se reemplazaría no tiene una referencia de API-Football que pueda vincularse de forma segura.";
  } else if (input.decision === "match" && duplicateProtected) {
    status = "history_conflict";
    explanation = canonicalProtected
      ? "No es posible consolidar estos jugadores automáticamente porque ambos tienen historial de votaciones que requiere revisión."
      : "Conserve como identidad principal al jugador que ya tiene historial de votaciones.";
  }
  if (input.decision === "match" && alias && proposedAlias) {
    try {
      playerProviderAliasTransition(alias, proposedAlias);
    } catch {
      status = "insufficient_evidence";
      explanation =
        "La identidad de API-Football ya está vinculada a otro jugador.";
    }
  }
  const canApply = status === "safe";
  return {
    decision: input.decision,
    status,
    canApply,
    explanation,
    canonical: evidence(
      canonical,
      canonicalMembership,
      canonicalParticipants,
      canonicalProtected,
    ),
    duplicate: evidence(
      duplicate,
      duplicateMembership,
      duplicateParticipants,
      duplicateProtected,
    ),
    suggestedCanonicalPlayerId: canonicalProtected
      ? canonical.id
      : duplicateProtected
        ? duplicate.id
        : canonical.id,
    ...(alias ? { currentAliasTarget: alias.canonicalPlayerId } : {}),
    ...(previousReview ? { previousReview: previousReview.status } : {}),
    proposedChanges:
      input.decision === "nonmatch"
        ? ["Guardar la decisión para no volver a sugerir esta pareja."]
        : [
            `Conservar a ${canonical.displayName} como identidad principal.`,
            `Vincular la identidad de API-Football de ${duplicate.displayName}.`,
            ...(missingCanonicalPhotoUrl(canonical, duplicate)
              ? [
                  `Completar la foto de ${canonical.displayName} con la foto disponible de ${duplicate.displayName}.`,
                ]
              : []),
            "Conservar sin cambios los jugadores, partidos, votos y resultados históricos.",
            ...(affectedDrafts > 0
              ? [`Actualizar ${affectedDrafts} borrador(es) seguros.`]
              : []),
          ],
    preservedReferences: {
      canonicalParticipations: canonicalParticipants.length,
      duplicateParticipations: duplicateParticipants.length,
      verifiedLineups,
      ownerDrafts: affectedDrafts,
      canonicalPublishedResults,
      duplicatePublishedResults,
    },
    warnings: [
      ...(normalizePlayerSearch(canonical.displayName) ===
      normalizePlayerSearch(duplicate.displayName)
        ? ["Los nombres coinciden, pero el nombre no demuestra identidad."]
        : ["Los nombres son distintos; confirme la identidad con cuidado."]),
      ...(verifiedLineups > 0
        ? ["Las alineaciones verificadas se conservarán sin cambios."]
        : []),
    ],
  };
}

function buildAlias(
  id: string,
  canonical: Player,
  duplicateProvider: { provider: string; externalId: string },
  timestampSnapshot: { readTime: Timestamp },
): PlayerProviderAlias {
  const timestamp = timestampSnapshot.readTime.toDate().toISOString();
  return {
    id,
    canonicalPlayerId: canonical.id,
    canonicalExternalProviderPlayerId:
      canonical.externalProvider === duplicateProvider.provider &&
      canonical.externalProviderId
        ? canonical.externalProviderId
        : duplicateProvider.externalId,
    externalProvider: duplicateProvider.provider,
    externalProviderPlayerId: duplicateProvider.externalId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validateInput(input: AdminPlayerIdentityInput): void {
  if (
    !validEntityId(input.firstPlayerId) ||
    !validEntityId(input.secondPlayerId) ||
    !validEntityId(input.canonicalPlayerId) ||
    !validEntityId(input.trackedTeamId) ||
    !["match", "nonmatch"].includes(input.decision) ||
    !/^[A-Za-z0-9_.@:-]{1,128}$/.test(input.operatorId)
  ) {
    throw new AdminPlayerIdentityRejectedError(
      "La selección de jugadores no es válida.",
    );
  }
}

function validEntityId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function providerIdentity(
  player: Player,
): { provider: string; externalId: string } | undefined {
  return player.externalProvider && player.externalProviderId
    ? {
        provider: player.externalProvider,
        externalId: player.externalProviderId,
      }
    : undefined;
}

function belongsToTeam(
  player: Player,
  membership: TeamPlayerMembership | undefined,
  participants: MatchParticipant[],
  teamId: string,
): boolean {
  return (
    player.currentTeamId === teamId ||
    membership?.teamId === teamId ||
    participants.some((participant) => participant.teamId === teamId)
  );
}

function resultCount(results: MatchResult[], playerId: string): number {
  return results.filter((result) => playerId in result.playerResults).length;
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
  hasProtectedHistory: boolean,
): IdentityEvidence {
  return {
    playerId: player.id,
    name: player.displayName,
    ...(player.currentTeamId ? { currentTeamId: player.currentTeamId } : {}),
    ...(player.position ? { position: player.position } : {}),
    ...(player.photoUrl ? { photoUrl: player.photoUrl } : {}),
    ...(membership?.shirtNumber === undefined
      ? {}
      : { shirtNumber: membership.shirtNumber }),
    identityProvenance:
      player.identityProvenance ??
      (player.externalProviderId ? "provider" : "operator_verified"),
    matchCount: new Set(participants.map(({ matchId }) => matchId)).size,
    hasProtectedHistory,
  };
}

function option(
  player: Player,
  membership: TeamPlayerMembership,
): PlayerIdentityOption {
  return {
    id: player.id,
    name: player.displayName,
    ...(player.position ? { position: player.position } : {}),
    ...(player.photoUrl ? { photoUrl: player.photoUrl } : {}),
    ...(membership.shirtNumber === undefined
      ? {}
      : { shirtNumber: membership.shirtNumber }),
    identityProvenance:
      player.identityProvenance ??
      (player.externalProviderId ? "provider" : "operator_verified"),
  };
}

function suggestionSignals(
  manual: Player,
  manualMembership: TeamPlayerMembership,
  provider: Player,
  providerMembership: TeamPlayerMembership,
): PlayerIdentitySuggestion["signals"] {
  const manualName = normalizePlayerSearch(manual.displayName);
  const providerName = normalizePlayerSearch(provider.displayName);
  const signals: PlayerIdentitySuggestion["signals"] = [];
  if (manualName === providerName) signals.push("name");
  else if (abbreviatedNamesMatch(manualName, providerName)) {
    signals.push("abbreviation");
  }
  if (manual.position && manual.position === provider.position) {
    signals.push("position");
  }
  if (
    manualMembership.shirtNumber !== undefined &&
    manualMembership.shirtNumber === providerMembership.shirtNumber
  ) {
    signals.push("shirt");
  }
  return signals;
}

function abbreviatedNamesMatch(first: string, second: string): boolean {
  const left = first.split(" ").filter(Boolean);
  const right = second.split(" ").filter(Boolean);
  if (left.length < 2 || right.length < 2) return false;
  return (
    left.at(-1) === right.at(-1) && left[0]?.charAt(0) === right[0]?.charAt(0)
  );
}

function isPlan(value: unknown): value is AdminPlayerIdentityPlan {
  return (
    isRecord(value) &&
    ["match", "nonmatch"].includes(String(value.decision)) &&
    typeof value.canApply === "boolean" &&
    typeof value.explanation === "string" &&
    Array.isArray(value.proposedChanges) &&
    Array.isArray(value.warnings)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
