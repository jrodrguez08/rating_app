import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import {
  proposedCoachProviderAlias,
  resolvePersistedCoachProviderAlias,
} from "@/domain/coach-identity";
import type {
  Coach,
  CoachAssignment,
  CoachIdentityReview,
  CoachProviderAlias,
  Match,
  VerifiedCoachAssignment,
} from "@/domain/models";
import { normalizePlayerSearch } from "@/domain/player-search";
import { getServerFirestore } from "@/lib/firebase/server";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import {
  adminCoachIdentityAuditId,
  adminCoachIdentityResourceId,
  coachIdentityReviewId,
  hashAdminCoachIdentityAction,
  type AdminCoachIdentityAction,
} from "@/lib/server/admin-coach-identity-action";

const PAGE_SIZE = 20;
const MAX_CATALOG_SCAN = 200;
const MAX_PROVENANCE_COACHES = 100;
const MAX_PAIR_ASSIGNMENTS = 200;
const MAX_SUGGESTIONS = 12;
const OWNER_SOURCE = "authenticated-owner";

export interface CoachIdentityOption {
  id: string;
  name: string;
  identityProvenance: "provider" | "operator_verified";
  photoUrl?: string;
  teamCount: number;
  matchCount: number;
}

export interface CoachIdentitySuggestion {
  first: CoachIdentityOption;
  second: CoachIdentityOption;
  suggestedCanonicalCoachId: string;
  signals: ("name" | "abbreviation" | "team" | "photo")[];
}

export interface CoachIdentitySuggestionResult {
  providerDataAvailable: boolean;
  suggestions: CoachIdentitySuggestion[];
}

export interface CoachSearchResult {
  coaches: CoachIdentityOption[];
  nextCursor?: string;
}

export interface CoachIdentityEvidence extends CoachIdentityOption {
  hasProtectedHistory: boolean;
  verifiedAssignments: number;
}

export interface AdminCoachIdentityPlan {
  decision: "match" | "nonmatch";
  status:
    | "safe"
    | "already_linked"
    | "confirmed_different"
    | "insufficient_evidence"
    | "history_conflict";
  canApply: boolean;
  explanation: string;
  canonical: CoachIdentityEvidence;
  duplicate: CoachIdentityEvidence;
  proposedChanges: string[];
  warnings: string[];
}

export interface AdminCoachIdentityResult {
  plan: AdminCoachIdentityPlan;
  auditId: string;
  disposition: "committed" | "idempotent_retry";
}

interface AdminCoachIdentityInput extends AdminCoachIdentityAction {
  operatorId: string;
}

interface CoachAssociation {
  coachId: string;
  matchId: string;
  teamId: string;
  verified: boolean;
}

export class AdminCoachIdentityRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminCoachIdentityRejectedError";
  }
}

export class AdminCoachIdentityCommitError extends Error {
  constructor() {
    super("No se pudo guardar la conciliación de directores técnicos.");
    this.name = "AdminCoachIdentityCommitError";
  }
}

export class AdminCoachIdentityService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async search(query: string, cursor?: string): Promise<CoachSearchResult> {
    const normalizedQuery = normalizePlayerSearch(query);
    let scanned = 0;
    let after = cursor;
    const coaches: Coach[] = [];
    let exhausted = false;
    while (coaches.length < PAGE_SIZE && scanned < MAX_CATALOG_SCAN) {
      let request = this.database
        .collection("coaches")
        .orderBy(FieldPath.documentId())
        .limit(PAGE_SIZE + 1);
      if (after) request = request.startAfter(after);
      const snapshot = await request.get();
      const page = snapshot.docs.slice(0, PAGE_SIZE);
      scanned += page.length;
      for (const document of page) {
        const coach = fromSnapshot<Coach>(document);
        if (
          !normalizedQuery ||
          normalizePlayerSearch(coach.displayName).includes(normalizedQuery)
        ) {
          coaches.push(coach);
        }
      }
      after = page.at(-1)?.id;
      exhausted = snapshot.size <= PAGE_SIZE;
      if (exhausted || page.length === 0) break;
    }
    const associations = await this.loadAssociations(
      coaches.map(({ id }) => id),
    );
    return {
      coaches: coaches
        .slice(0, PAGE_SIZE)
        .map((coach) => option(coach, associations.get(coach.id) ?? [])),
      ...(!exhausted && after ? { nextCursor: after } : {}),
    };
  }

  async suggestions(): Promise<CoachIdentitySuggestionResult> {
    const [manualSnapshot, providerSnapshot] = await Promise.all([
      this.database
        .collection("coaches")
        .where("identityProvenance", "==", "operator_verified")
        .limit(MAX_PROVENANCE_COACHES + 1)
        .get(),
      this.database
        .collection("coaches")
        .where("identityProvenance", "==", "provider")
        .limit(MAX_PROVENANCE_COACHES + 1)
        .get(),
    ]);
    if (
      manualSnapshot.size > MAX_PROVENANCE_COACHES ||
      providerSnapshot.size > MAX_PROVENANCE_COACHES
    ) {
      throw new AdminCoachIdentityRejectedError(
        "El catálogo de directores técnicos supera el límite seguro de sugerencias.",
      );
    }
    const manual = manualSnapshot.docs.map((document) =>
      fromSnapshot<Coach>(document),
    );
    const provider = providerSnapshot.docs.map((document) =>
      fromSnapshot<Coach>(document),
    );
    const all = [...manual, ...provider];
    const associations = await this.loadAssociations(all.map(({ id }) => id));
    const candidates = manual
      .flatMap((manualCoach) =>
        provider.flatMap((providerCoach) => {
          const signals = suggestionSignals(
            manualCoach,
            associations.get(manualCoach.id) ?? [],
            providerCoach,
            associations.get(providerCoach.id) ?? [],
          );
          if (!signals.includes("name") && !signals.includes("abbreviation")) {
            return [];
          }
          return [{ manualCoach, providerCoach, signals }];
        }),
      )
      .sort(
        (left, right) =>
          right.signals.length - left.signals.length ||
          left.manualCoach.displayName.localeCompare(
            right.manualCoach.displayName,
            "es",
          ),
      )
      .slice(0, 100);
    const reviewReferences = candidates.map(({ manualCoach, providerCoach }) =>
      this.database.doc(
        `coachIdentityReviews/${coachIdentityReviewId(manualCoach.id, providerCoach.id)}`,
      ),
    );
    const reviews =
      reviewReferences.length === 0
        ? []
        : await this.database.getAll(...reviewReferences);
    return {
      providerDataAvailable: provider.length > 0,
      suggestions: candidates
        .filter((_, index) => !reviews[index].exists)
        .slice(0, MAX_SUGGESTIONS)
        .map(({ manualCoach, providerCoach, signals }) => ({
          first: option(manualCoach, associations.get(manualCoach.id) ?? []),
          second: option(
            providerCoach,
            associations.get(providerCoach.id) ?? [],
          ),
          suggestedCanonicalCoachId: manualCoach.id,
          signals,
        })),
    };
  }

  async preview(
    input: AdminCoachIdentityInput,
  ): Promise<AdminCoachIdentityPlan> {
    const result = await this.execute(input);
    if ("auditId" in result) throw new Error("Unexpected audit receipt.");
    return result;
  }

  async applyAuthorized(
    input: AdminCoachIdentityInput,
    challengeToken: string | undefined,
  ): Promise<AdminCoachIdentityResult> {
    if (!challengeToken || challengeToken.length > 256) {
      throw new AdminCoachIdentityRejectedError(
        "La autorización de esta acción no es válida.",
      );
    }
    try {
      const result = await this.execute(input, challengeToken);
      if (!("auditId" in result)) throw new Error("Audit receipt is missing.");
      return result;
    } catch (error) {
      if (error instanceof AdminCoachIdentityRejectedError) throw error;
      throw new AdminCoachIdentityCommitError();
    }
  }

  private async execute(
    input: AdminCoachIdentityInput,
    challengeToken?: string,
  ): Promise<AdminCoachIdentityPlan | AdminCoachIdentityResult> {
    validateInput(input);
    if (input.firstCoachId === input.secondCoachId) {
      throw new AdminCoachIdentityRejectedError(
        "Seleccione dos directores técnicos distintos.",
      );
    }
    if (
      ![input.firstCoachId, input.secondCoachId].includes(
        input.canonicalCoachId,
      )
    ) {
      throw new AdminCoachIdentityRejectedError(
        "El director técnico que desea conservar no pertenece a la comparación.",
      );
    }
    const coachIds = [input.firstCoachId, input.secondCoachId];
    const reviewId = coachIdentityReviewId(...(coachIds as [string, string]));
    const actionHash = hashAdminCoachIdentityAction(input);
    return this.database.runTransaction(async (transaction) => {
      const challengeId = challengeToken
        ? adminChallengeDocumentId(challengeToken)
        : undefined;
      const challengeReference = challengeId
        ? this.database.doc(`adminActionChallenges/${challengeId}`)
        : undefined;
      const auditId = challengeId
        ? adminCoachIdentityAuditId(challengeId)
        : undefined;
      const auditReference = auditId
        ? this.database.doc(`adminAudit/${auditId}`)
        : undefined;
      if (challengeReference && auditReference && auditId) {
        const [challengeSnapshot, auditSnapshot] = await Promise.all([
          transaction.get(challengeReference),
          transaction.get(auditReference),
        ]);
        if (!challengeSnapshot.exists) {
          throw new AdminCoachIdentityRejectedError(
            "La autorización de esta acción no es válida.",
          );
        }
        const challenge = challengeSnapshot.data() ?? {};
        if (
          challenge.operatorUid !== input.operatorId ||
          challenge.resourceId !== adminCoachIdentityResourceId(input) ||
          challenge.actionHash !== actionHash
        ) {
          throw new AdminCoachIdentityRejectedError(
            "La autorización no corresponde a esta conciliación.",
          );
        }
        if (challenge.consumedAt !== undefined) {
          const audit = auditSnapshot.data() ?? {};
          if (
            !auditSnapshot.exists ||
            challenge.committedAuditId !== auditId ||
            audit.actionHash !== actionHash ||
            audit.outcome !== "success" ||
            !isPlan(audit.plan)
          ) {
            throw new AdminCoachIdentityRejectedError(
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
          !(challenge.expiresAt instanceof Timestamp) ||
          challenge.expiresAt.toMillis() <=
            challengeSnapshot.readTime.toMillis()
        ) {
          throw new AdminCoachIdentityRejectedError(
            "La autorización de esta acción venció.",
          );
        }
      }

      const coachReferences = coachIds.map((id) =>
        this.database.doc(`coaches/${id}`),
      );
      const reviewReference = this.database.doc(
        `coachIdentityReviews/${reviewId}`,
      );
      const assignmentsQuery = this.database
        .collectionGroup("coachAssignments")
        .where("coachId", "in", coachIds)
        .limit(MAX_PAIR_ASSIGNMENTS + 1);
      const verifiedQuery = this.database
        .collectionGroup("verifiedCoachAssignments")
        .where("coachId", "in", coachIds)
        .limit(MAX_PAIR_ASSIGNMENTS + 1);
      const [
        coachSnapshots,
        reviewSnapshot,
        assignmentsSnapshot,
        verifiedSnapshot,
      ] = await Promise.all([
        transaction.getAll(...coachReferences),
        transaction.get(reviewReference),
        transaction.get(assignmentsQuery),
        transaction.get(verifiedQuery),
      ]);
      if (coachSnapshots.some((snapshot) => !snapshot.exists)) {
        throw new AdminCoachIdentityRejectedError(
          "Uno de los directores técnicos seleccionados ya no existe.",
        );
      }
      if (
        assignmentsSnapshot.size > MAX_PAIR_ASSIGNMENTS ||
        verifiedSnapshot.size > MAX_PAIR_ASSIGNMENTS
      ) {
        throw new AdminCoachIdentityRejectedError(
          "El historial supera el límite seguro de conciliación.",
        );
      }
      const coaches = coachSnapshots.map((snapshot) =>
        fromSnapshot<Coach>(snapshot),
      );
      const canonicalIndex = coachIds.indexOf(input.canonicalCoachId);
      const duplicateIndex = canonicalIndex === 0 ? 1 : 0;
      const canonical = coaches[canonicalIndex];
      const duplicate = coaches[duplicateIndex];
      const associations = [
        ...assignmentsSnapshot.docs.map((document) => {
          const value = fromSnapshot<CoachAssignment>(document);
          return {
            coachId: value.coachId,
            matchId: value.matchId,
            teamId: value.teamId,
            verified: false,
          };
        }),
        ...verifiedSnapshot.docs.map((document) => {
          const value = fromSnapshot<VerifiedCoachAssignment>(document);
          return {
            coachId: value.coachId,
            matchId: value.matchId,
            teamId: value.trackedTeamId,
            verified: true,
          };
        }),
      ];
      const matchIds = [...new Set(associations.map(({ matchId }) => matchId))];
      const [matchSnapshots, resultSnapshots, ballotSnapshots] =
        matchIds.length === 0
          ? [[], [], []]
          : await Promise.all([
              transaction.getAll(
                ...matchIds.map((id) => this.database.doc(`matches/${id}`)),
              ),
              transaction.getAll(
                ...matchIds.map((id) =>
                  this.database.doc(`matches/${id}/results/summary`),
                ),
              ),
              Promise.all(
                matchIds.map((id) =>
                  transaction.get(
                    this.database.collection(`matches/${id}/ballots`).limit(1),
                  ),
                ),
              ),
            ]);
      const protectedMatches = new Set<string>();
      matchIds.forEach((id, index) => {
        const match = matchSnapshots[index]?.exists
          ? fromSnapshot<Match>(matchSnapshots[index])
          : undefined;
        if (
          match?.ratingState === "rating_ready" ||
          match?.ratingState === "rating_closed" ||
          resultSnapshots[index]?.exists ||
          !ballotSnapshots[index]?.empty
        ) {
          protectedMatches.add(id);
        }
      });
      const canonicalAssociations = associations.filter(
        ({ coachId }) => coachId === canonical.id,
      );
      const duplicateAssociations = associations.filter(
        ({ coachId }) => coachId === duplicate.id,
      );
      const sameMatch = canonicalAssociations.some(({ matchId }) =>
        duplicateAssociations.some((value) => value.matchId === matchId),
      );
      const canonicalProtected = canonicalAssociations.some(({ matchId }) =>
        protectedMatches.has(matchId),
      );
      const duplicateProtected = duplicateAssociations.some(({ matchId }) =>
        protectedMatches.has(matchId),
      );
      const providerCoaches = coaches.filter(
        (coach) => coach.externalProvider && coach.externalProviderId,
      );
      const providerCoach =
        providerCoaches.length === 1 ? providerCoaches[0] : undefined;
      const proposedAlias = providerCoach
        ? proposedCoachProviderAlias(
            providerCoach.externalProvider!,
            providerCoach.externalProviderId!,
            coachSnapshots[0].readTime.toDate().toISOString(),
            canonical.id,
          )
        : undefined;
      const aliasReference = proposedAlias
        ? this.database.doc(`coachProviderAliases/${proposedAlias.id}`)
        : undefined;
      const aliasSnapshot = aliasReference
        ? await transaction.get(aliasReference)
        : undefined;
      const alias = aliasSnapshot?.exists
        ? fromSnapshot<CoachProviderAlias>(aliasSnapshot)
        : undefined;
      const previousReview = reviewSnapshot.exists
        ? fromSnapshot<CoachIdentityReview>(reviewSnapshot)
        : undefined;
      const plan = buildPlan({
        input,
        canonical,
        duplicate,
        canonicalAssociations,
        duplicateAssociations,
        canonicalProtected,
        duplicateProtected,
        sameMatch,
        providerCoach,
        proposedAlias,
        alias,
        previousReview,
      });
      if (!challengeReference || !auditReference || !auditId) return plan;
      if (!plan.canApply) {
        throw new AdminCoachIdentityRejectedError(plan.explanation);
      }
      const timestamp = coachSnapshots[0].readTime.toDate().toISOString();
      if (input.decision === "match" && aliasReference && proposedAlias) {
        const resolved = resolvePersistedCoachProviderAlias(
          alias,
          proposedAlias,
        );
        if (!alias) transaction.create(aliasReference, toDocument(resolved));
        else transaction.set(aliasReference, toDocument(resolved));
        if (
          canonical.externalProvider === undefined &&
          canonical.externalProviderId === undefined &&
          providerCoach
        ) {
          transaction.update(coachReferences[canonicalIndex], {
            externalProvider: providerCoach.externalProvider,
            externalProviderId: providerCoach.externalProviderId,
            ...(canonical.photoUrl === undefined && providerCoach.photoUrl
              ? { photoUrl: providerCoach.photoUrl }
              : {}),
            updatedAt: Timestamp.fromDate(new Date(timestamp)),
          });
        }
      }
      const ordered = [...coachIds].sort();
      const review: CoachIdentityReview = {
        id: reviewId,
        firstCoachId: ordered[0],
        secondCoachId: ordered[1],
        canonicalCoachId: canonical.id,
        decision: input.decision,
        status: "active",
        operatorId: input.operatorId,
        reviewedAt: timestamp,
        createdAt: previousReview?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      transaction.set(reviewReference, toDocument(review));
      transaction.update(challengeReference, {
        consumedAt: Timestamp.fromDate(new Date(timestamp)),
        committedAuditId: auditId,
      });
      transaction.create(auditReference, {
        operatorUid: input.operatorId,
        action: "coach_identity_apply",
        resourceId: adminCoachIdentityResourceId(input),
        firstCoachId: input.firstCoachId,
        secondCoachId: input.secondCoachId,
        canonicalCoachId: canonical.id,
        duplicateCoachId: duplicate.id,
        decision: input.decision,
        evidenceReference: OWNER_SOURCE,
        actionHash,
        outcome: "success",
        commitDisposition: "committed",
        plan: toDocument(plan),
        createdAt: Timestamp.fromDate(new Date(timestamp)),
      });
      return { plan, auditId, disposition: "committed" as const };
    });
  }

  private async loadAssociations(
    coachIds: string[],
  ): Promise<Map<string, CoachAssociation[]>> {
    const result = new Map<string, CoachAssociation[]>();
    for (let offset = 0; offset < coachIds.length; offset += 30) {
      const ids = coachIds.slice(offset, offset + 30);
      if (ids.length === 0) continue;
      const [assignments, verified] = await Promise.all([
        this.database
          .collectionGroup("coachAssignments")
          .where("coachId", "in", ids)
          .limit(MAX_PAIR_ASSIGNMENTS + 1)
          .get(),
        this.database
          .collectionGroup("verifiedCoachAssignments")
          .where("coachId", "in", ids)
          .limit(MAX_PAIR_ASSIGNMENTS + 1)
          .get(),
      ]);
      if (
        assignments.size > MAX_PAIR_ASSIGNMENTS ||
        verified.size > MAX_PAIR_ASSIGNMENTS
      ) {
        throw new AdminCoachIdentityRejectedError(
          "El historial supera el límite seguro de consulta.",
        );
      }
      for (const document of assignments.docs) {
        const value = fromSnapshot<CoachAssignment>(document);
        append(result, {
          coachId: value.coachId,
          matchId: value.matchId,
          teamId: value.teamId,
          verified: false,
        });
      }
      for (const document of verified.docs) {
        const value = fromSnapshot<VerifiedCoachAssignment>(document);
        append(result, {
          coachId: value.coachId,
          matchId: value.matchId,
          teamId: value.trackedTeamId,
          verified: true,
        });
      }
    }
    return result;
  }
}

function buildPlan(values: {
  input: AdminCoachIdentityInput;
  canonical: Coach;
  duplicate: Coach;
  canonicalAssociations: CoachAssociation[];
  duplicateAssociations: CoachAssociation[];
  canonicalProtected: boolean;
  duplicateProtected: boolean;
  sameMatch: boolean;
  providerCoach?: Coach;
  proposedAlias?: CoachProviderAlias;
  alias?: CoachProviderAlias;
  previousReview?: CoachIdentityReview;
}): AdminCoachIdentityPlan {
  const {
    input,
    canonical,
    duplicate,
    canonicalAssociations,
    duplicateAssociations,
    canonicalProtected,
    duplicateProtected,
    sameMatch,
    providerCoach,
    proposedAlias,
    alias,
    previousReview,
  } = values;
  let status: AdminCoachIdentityPlan["status"] = "safe";
  let explanation =
    input.decision === "match"
      ? "La identidad de API-Football se vinculará al director técnico que decidió conservar."
      : "La pareja quedará marcada como directores técnicos diferentes.";
  const alreadyLinked =
    alias !== undefined &&
    proposedAlias !== undefined &&
    alias.canonicalCoachId === canonical.id;
  if (input.decision === "nonmatch" && alreadyLinked) {
    status = "already_linked";
    explanation = "Estos directores técnicos ya están conciliados.";
  } else if (
    input.decision === "nonmatch" &&
    previousReview?.decision === "nonmatch"
  ) {
    status = "confirmed_different";
    explanation =
      "Esta pareja ya fue confirmada como directores técnicos diferentes.";
  } else if (
    input.decision === "match" &&
    previousReview?.decision === "match"
  ) {
    status = "already_linked";
    explanation = "Estos directores técnicos ya están conciliados.";
  } else if (input.decision === "match" && sameMatch) {
    status = "history_conflict";
    explanation =
      "Ambos directores técnicos aparecen en el mismo partido. Revise ese historial antes de consolidar.";
  } else if (
    input.decision === "match" &&
    canonicalProtected &&
    duplicateProtected
  ) {
    status = "history_conflict";
    explanation =
      "Ambos directores técnicos tienen historial de votaciones protegido y requieren revisión especial.";
  } else if (input.decision === "match" && duplicateProtected) {
    status = "history_conflict";
    explanation =
      "Conserve al director técnico que ya tiene historial de votaciones y vuelva a revisar.";
  } else if (input.decision === "match" && (!providerCoach || !proposedAlias)) {
    status = "insufficient_evidence";
    explanation =
      "La comparación debe incluir exactamente un director técnico con identidad de API-Football.";
  } else if (
    input.decision === "match" &&
    providerCoach !== undefined &&
    canonical.externalProviderId !== undefined &&
    (canonical.externalProvider !== providerCoach.externalProvider ||
      canonical.externalProviderId !== providerCoach.externalProviderId)
  ) {
    status = "insufficient_evidence";
    explanation =
      "El director técnico elegido ya tiene otra identidad de proveedor.";
  }
  if (input.decision === "match" && proposedAlias) {
    try {
      resolvePersistedCoachProviderAlias(alias, proposedAlias);
    } catch {
      status = "insufficient_evidence";
      explanation =
        "La identidad de API-Football ya está vinculada a otro director técnico.";
    }
  }
  return {
    decision: input.decision,
    status,
    canApply: status === "safe",
    explanation,
    canonical: evidence(canonical, canonicalAssociations, canonicalProtected),
    duplicate: evidence(duplicate, duplicateAssociations, duplicateProtected),
    proposedChanges:
      input.decision === "nonmatch"
        ? ["Guardar la decisión para no volver a sugerir esta pareja."]
        : [
            `Conservar a ${canonical.displayName} como identidad principal.`,
            "Vincular su identidad de API-Football para futuros partidos.",
            "Conservar sin cambios las asignaciones, votos y resultados existentes.",
          ],
    warnings: [
      normalizePlayerSearch(canonical.displayName) ===
      normalizePlayerSearch(duplicate.displayName)
        ? "Los nombres coinciden, pero el nombre no demuestra identidad."
        : "Los nombres son distintos; confirme la identidad con cuidado.",
    ],
  };
}

function option(
  coach: Coach,
  associations: CoachAssociation[],
): CoachIdentityOption {
  return {
    id: coach.id,
    name: coach.displayName,
    identityProvenance:
      coach.identityProvenance ??
      (coach.externalProviderId ? "provider" : "operator_verified"),
    ...(coach.photoUrl ? { photoUrl: coach.photoUrl } : {}),
    teamCount: new Set(associations.map(({ teamId }) => teamId)).size,
    matchCount: new Set(associations.map(({ matchId }) => matchId)).size,
  };
}

function evidence(
  coach: Coach,
  associations: CoachAssociation[],
  hasProtectedHistory: boolean,
): CoachIdentityEvidence {
  return {
    ...option(coach, associations),
    hasProtectedHistory,
    verifiedAssignments: new Set(
      associations
        .filter(({ verified }) => verified)
        .map(({ matchId }) => matchId),
    ).size,
  };
}

function suggestionSignals(
  manual: Coach,
  manualAssociations: CoachAssociation[],
  provider: Coach,
  providerAssociations: CoachAssociation[],
): CoachIdentitySuggestion["signals"] {
  const manualName = normalizePlayerSearch(manual.displayName);
  const providerName = normalizePlayerSearch(provider.displayName);
  const signals: CoachIdentitySuggestion["signals"] = [];
  if (manualName === providerName) signals.push("name");
  else if (abbreviatedNamesMatch(manualName, providerName)) {
    signals.push("abbreviation");
  }
  const manualTeams = new Set(manualAssociations.map(({ teamId }) => teamId));
  if (providerAssociations.some(({ teamId }) => manualTeams.has(teamId))) {
    signals.push("team");
  }
  if (manual.photoUrl && manual.photoUrl === provider.photoUrl)
    signals.push("photo");
  return signals;
}

function abbreviatedNamesMatch(first: string, second: string): boolean {
  const left = first.split(" ").filter(Boolean);
  const right = second.split(" ").filter(Boolean);
  return (
    left.length >= 2 &&
    right.length >= 2 &&
    left.at(-1) === right.at(-1) &&
    left[0]?.charAt(0) === right[0]?.charAt(0)
  );
}

function append(
  result: Map<string, CoachAssociation[]>,
  association: CoachAssociation,
) {
  result.set(association.coachId, [
    ...(result.get(association.coachId) ?? []),
    association,
  ]);
}

function validateInput(input: AdminCoachIdentityInput): void {
  if (
    !validEntityId(input.firstCoachId) ||
    !validEntityId(input.secondCoachId) ||
    !validEntityId(input.canonicalCoachId) ||
    !["match", "nonmatch"].includes(input.decision) ||
    !/^[A-Za-z0-9_.@:-]{1,128}$/.test(input.operatorId)
  ) {
    throw new AdminCoachIdentityRejectedError(
      "La selección de directores técnicos no es válida.",
    );
  }
}

function validEntityId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isPlan(value: unknown): value is AdminCoachIdentityPlan {
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
