import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import { COACH_SEARCH_INDEX_VERSION } from "@/application/coach-search";
import { coachProviderAliasId } from "@/domain/coach-identity";
import type { Coach, CoachProviderAlias } from "@/domain/models";
import { normalizePlayerSearch } from "@/domain/player-search";

export const ADMIN_COACH_PAGE_SIZE = 20;

export type CoachSearchScope = "team" | "unassociated" | "identity";

export interface IndexedCoachOption {
  id: string;
  name: string;
  provenance: "provider" | "operator_verified";
  externalProviderId?: string;
  photoUrl?: string;
  teamCount?: number;
}

export interface CoachSearchPage {
  coaches: IndexedCoachOption[];
  nextCursor?: string;
}

export type CoachIndexReadObserver = (read: {
  kind: "index_state" | "coach_query" | "alias_lookup" | "canonical_lookup";
  documents: number;
}) => void;

export class CoachSearchIndexIncompleteError extends Error {
  constructor() {
    super("Coach search index is incomplete.");
    this.name = "CoachSearchIndexIncompleteError";
  }
}

export class CoachSearchInvalidInputError extends Error {
  constructor() {
    super("Coach search input is invalid.");
    this.name = "CoachSearchInvalidInputError";
  }
}

export async function searchIndexedCoaches(
  database: Firestore,
  teamId: string,
  scope: CoachSearchScope,
  query: string,
  cursor?: string,
  observe?: CoachIndexReadObserver,
): Promise<CoachSearchPage> {
  const normalized = normalizePlayerSearch(query);
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(teamId) ||
    query.length > 80 ||
    (cursor !== undefined && cursor.length > 512) ||
    (scope === "unassociated" && normalized.length < 2)
  ) {
    throw new CoachSearchInvalidInputError();
  }
  const after = cursor
    ? decodeCursor(cursor, teamId, scope, normalized)
    : undefined;
  const indexSnapshot = await database.doc("coachSearchIndex/state").get();
  observe?.({ kind: "index_state", documents: indexSnapshot.exists ? 1 : 0 });
  const index = indexSnapshot.data();
  if (
    !indexSnapshot.exists ||
    index?.status !== "complete" ||
    index?.schemaVersion !== COACH_SEARCH_INDEX_VERSION ||
    index?.blockingIssueCount !== 0
  ) {
    throw new CoachSearchIndexIncompleteError();
  }

  const field =
    scope === "unassociated"
      ? "unassociatedSearchKeys"
      : scope === "identity" && normalized
        ? "searchPrefixes"
        : normalized
          ? "teamSearchKeys"
          : "teamBrowseKeys";
  const value =
    scope === "unassociated"
      ? normalized
      : scope === "identity" && normalized
        ? normalized
        : normalized
          ? `${teamId}:${normalized}`
          : teamId;
  let request = database
    .collection("coaches")
    .where(field, "array-contains", value)
    .orderBy(FieldPath.documentId())
    .limit(ADMIN_COACH_PAGE_SIZE + 1);
  if (after) request = request.startAfter(after);
  const snapshot = await request.get();
  observe?.({ kind: "coach_query", documents: snapshot.size });
  const sources = snapshot.docs
    .slice(0, ADMIN_COACH_PAGE_SIZE)
    .map(fromSnapshot<Coach>);
  const aliased = sources.filter(
    (coach) => coach.externalProvider && coach.externalProviderId,
  );
  const aliases =
    aliased.length === 0
      ? []
      : await database.getAll(
          ...aliased.map((coach) =>
            database.doc(
              `coachProviderAliases/${coachProviderAliasId(coach.externalProvider!, coach.externalProviderId!)}`,
            ),
          ),
        );
  observe?.({ kind: "alias_lookup", documents: aliases.length });
  const canonicalIds = new Map<string, string>();
  aliases.forEach((alias, index) => {
    if (!alias.exists) return;
    const coach = aliased[index];
    const binding = fromSnapshot<CoachProviderAlias>(alias);
    if (
      binding.externalProvider !== coach.externalProvider ||
      binding.externalProviderCoachId !== coach.externalProviderId
    ) {
      throw new CoachSearchIndexIncompleteError();
    }
    canonicalIds.set(coach.id, binding.canonicalCoachId);
  });
  const missingIds = [...new Set(canonicalIds.values())].filter(
    (id) => !sources.some((coach) => coach.id === id),
  );
  const canonicalSnapshots =
    missingIds.length === 0
      ? []
      : await database.getAll(
          ...missingIds.map((id) => database.doc(`coaches/${id}`)),
        );
  observe?.({ kind: "canonical_lookup", documents: canonicalSnapshots.length });
  const coaches = new Map(sources.map((coach) => [coach.id, coach]));
  canonicalSnapshots.forEach((document) => {
    if (!document.exists) throw new CoachSearchIndexIncompleteError();
    coaches.set(document.id, fromSnapshot<Coach>(document));
  });
  const options = new Map<string, IndexedCoachOption>();
  for (const source of sources) {
    const canonicalId = canonicalIds.get(source.id) ?? source.id;
    const coach = coaches.get(canonicalId);
    if (!coach) throw new CoachSearchIndexIncompleteError();
    if (
      scope === "unassociated" &&
      (coach.associatedTeamIds?.length ?? 0) > 0
    ) {
      continue;
    }
    if (
      scope === "identity" &&
      (coach.associatedTeamIds?.length ?? 0) > 0 &&
      !coach.associatedTeamIds?.includes(teamId)
    ) {
      continue;
    }
    options.set(coach.id, {
      id: coach.id,
      name: coach.displayName,
      provenance:
        coach.identityProvenance ??
        (coach.externalProviderId ? "provider" : "operator_verified"),
      ...(coach.externalProviderId
        ? { externalProviderId: coach.externalProviderId }
        : {}),
      ...(coach.photoUrl ? { photoUrl: coach.photoUrl } : {}),
      teamCount: coach.associatedTeamIds?.length ?? 0,
    });
  }
  const last =
    snapshot.docs[Math.min(snapshot.size, ADMIN_COACH_PAGE_SIZE) - 1];
  return {
    coaches: [...options.values()],
    ...(snapshot.size > ADMIN_COACH_PAGE_SIZE && last
      ? { nextCursor: encodeCursor(teamId, scope, normalized, last.id) }
      : {}),
  };
}

function encodeCursor(
  teamId: string,
  scope: CoachSearchScope,
  query: string,
  lastId: string,
): string {
  return Buffer.from(
    JSON.stringify([1, teamId, scope, query, lastId]),
  ).toString("base64url");
}

function decodeCursor(
  cursor: string,
  teamId: string,
  scope: CoachSearchScope,
  query: string,
): string {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 5 ||
      decoded[0] !== 1 ||
      decoded[1] !== teamId ||
      decoded[2] !== scope ||
      decoded[3] !== query ||
      typeof decoded[4] !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(decoded[4]) ||
      encodeCursor(teamId, scope, query, decoded[4]) !== cursor
    ) {
      throw new CoachSearchInvalidInputError();
    }
    return decoded[4];
  } catch {
    throw new CoachSearchInvalidInputError();
  }
}

function fromSnapshot<T>(snapshot: {
  id: string;
  data(): DocumentData | undefined;
}): T {
  const data = snapshot.data();
  if (!data) throw new CoachSearchIndexIncompleteError();
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
