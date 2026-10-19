import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { mergeTeamPlayerMembership } from "@/application/team-player-membership";
import type {
  Match,
  MatchResult,
  Player,
  PlayerProviderAlias,
  TeamPlayerMembership,
  TeamPlayerMembershipIndex,
} from "@/domain/models";
import { playerProviderAliasId } from "@/domain/player-identity";
import { normalizePlayerSearch } from "@/domain/player-search";

const INDEX_SCHEMA_VERSION = 1;
const LOOKUP_BATCH_SIZE = 100;
const PUBLIC_PAGE_SIZE = 100;
export const ADMIN_PLAYER_PAGE_SIZE = 20;

export type TeamPlayerIndexReadKind =
  | "index_state"
  | "membership_query"
  | "player_lookup"
  | "alias_lookup"
  | "canonical_player_lookup"
  | "result_query"
  | "match_lookup";

export interface TeamPlayerIndexRead {
  kind: TeamPlayerIndexReadKind;
  documents: number;
}

export type TeamPlayerIndexObserver = (read: TeamPlayerIndexRead) => void;

export interface IndexedTeamPlayer {
  player: Player;
  membership: TeamPlayerMembership;
}

export class TeamPlayerMembershipIndexIncompleteError extends Error {
  constructor(teamId: string) {
    super(`Team Player membership index is incomplete for ${teamId}.`);
    this.name = "TeamPlayerMembershipIndexIncompleteError";
  }
}

export async function searchIndexedTeamPlayers(
  database: Firestore,
  teamId: string,
  query: string,
  cursor?: string,
  observe?: TeamPlayerIndexObserver,
): Promise<{ players: IndexedTeamPlayer[]; nextCursor?: string }> {
  await requireCompleteIndex(database, teamId, observe);
  const normalizedQuery = normalizePlayerSearch(query).slice(0, 80);
  let membershipQuery = database
    .collection(`teams/${teamId}/playerMemberships`)
    .orderBy(FieldPath.documentId());
  if (normalizedQuery) {
    membershipQuery = membershipQuery.where(
      "searchPrefixes",
      "array-contains",
      normalizedQuery,
    );
  }
  if (cursor) membershipQuery = membershipQuery.startAfter(cursor);
  const snapshot = await membershipQuery
    .limit(ADMIN_PLAYER_PAGE_SIZE + 1)
    .get();
  observe?.({ kind: "membership_query", documents: snapshot.size });
  const page = snapshot.docs.slice(0, ADMIN_PLAYER_PAGE_SIZE);
  const { players } = await resolveMemberships(database, teamId, page, observe);
  const lastDocument = page.at(-1);
  return {
    players,
    ...(snapshot.size > ADMIN_PLAYER_PAGE_SIZE && lastDocument
      ? { nextCursor: lastDocument.id }
      : {}),
  };
}

export async function readIndexedTeamPlayers(
  database: Firestore,
  teamId: string,
  observe?: TeamPlayerIndexObserver,
): Promise<{
  players: IndexedTeamPlayer[];
  canonicalPlayerIds: ReadonlyMap<string, string>;
}> {
  await requireCompleteIndex(database, teamId, observe);
  const documents: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = database
      .collection(`teams/${teamId}/playerMemberships`)
      .orderBy(FieldPath.documentId())
      .limit(PUBLIC_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    observe?.({ kind: "membership_query", documents: snapshot.size });
    documents.push(...snapshot.docs);
    cursor =
      snapshot.size === PUBLIC_PAGE_SIZE ? snapshot.docs.at(-1) : undefined;
  } while (cursor);
  const resolved = await resolveMemberships(
    database,
    teamId,
    documents,
    observe,
  );
  return {
    players: resolved.players,
    canonicalPlayerIds: resolved.canonicalPlayerIds,
  };
}

export async function readPublishedTeamHistory(
  database: Firestore,
  teamId: string,
  observe?: TeamPlayerIndexObserver,
): Promise<{ matches: Match[]; results: MatchResult[] }> {
  const results: MatchResult[] = [];
  const matchReferences: DocumentReference[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = database
      .collectionGroup("results")
      .where("teamId", "==", teamId)
      .orderBy(FieldPath.documentId())
      .limit(PUBLIC_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    observe?.({ kind: "result_query", documents: snapshot.size });
    for (const document of snapshot.docs) {
      const matchReference = document.ref.parent.parent;
      if (!matchReference) continue;
      const result = fromDocument<MatchResult>(document);
      if (result.status !== "final") continue;
      results.push(result);
      matchReferences.push(matchReference);
    }
    cursor =
      snapshot.size === PUBLIC_PAGE_SIZE ? snapshot.docs.at(-1) : undefined;
  } while (cursor);
  const matches: Match[] = [];
  for (
    let offset = 0;
    offset < matchReferences.length;
    offset += LOOKUP_BATCH_SIZE
  ) {
    const snapshots = await database.getAll(
      ...matchReferences.slice(offset, offset + LOOKUP_BATCH_SIZE),
    );
    observe?.({ kind: "match_lookup", documents: snapshots.length });
    for (const snapshot of snapshots) {
      if (snapshot.exists) matches.push(fromDocument<Match>(snapshot));
    }
  }
  return { matches, results };
}

export async function resolveIndexedCanonicalPlayerIds(
  database: Firestore,
  playerIds: readonly string[],
  observe?: TeamPlayerIndexObserver,
): Promise<ReadonlyMap<string, string>> {
  const players = await readPlayers(
    database,
    playerIds,
    "player_lookup",
    observe,
  );
  const providerPlayers = [...players.values()].filter(
    (player) => player.externalProvider && player.externalProviderId,
  );
  const resolved = new Map(playerIds.map((playerId) => [playerId, playerId]));
  for (
    let offset = 0;
    offset < providerPlayers.length;
    offset += LOOKUP_BATCH_SIZE
  ) {
    const page = providerPlayers.slice(offset, offset + LOOKUP_BATCH_SIZE);
    const snapshots = await database.getAll(
      ...page.map((player) =>
        database.doc(
          `playerProviderAliases/${playerProviderAliasId(
            player.externalProvider!,
            player.externalProviderId!,
          )}`,
        ),
      ),
    );
    observe?.({ kind: "alias_lookup", documents: snapshots.length });
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      resolved.set(
        page[index].id,
        fromDocument<PlayerProviderAlias>(snapshot).canonicalPlayerId,
      );
    });
  }
  return resolved;
}

async function requireCompleteIndex(
  database: Firestore,
  teamId: string,
  observe?: TeamPlayerIndexObserver,
): Promise<TeamPlayerMembershipIndex> {
  const snapshot = await database
    .doc(`teams/${teamId}/playerMembershipIndex/state`)
    .get();
  observe?.({ kind: "index_state", documents: snapshot.exists ? 1 : 0 });
  if (!snapshot.exists)
    throw new TeamPlayerMembershipIndexIncompleteError(teamId);
  const state = fromDocument<TeamPlayerMembershipIndex>(snapshot);
  if (
    state.teamId !== teamId ||
    state.status !== "complete" ||
    state.schemaVersion !== INDEX_SCHEMA_VERSION ||
    state.blockingIssueCount !== 0
  ) {
    throw new TeamPlayerMembershipIndexIncompleteError(teamId);
  }
  return state;
}

async function resolveMemberships(
  database: Firestore,
  teamId: string,
  documents: readonly QueryDocumentSnapshot[],
  observe?: TeamPlayerIndexObserver,
): Promise<{
  players: IndexedTeamPlayer[];
  canonicalPlayerIds: ReadonlyMap<string, string>;
}> {
  const memberships = documents.map(fromMembershipDocument);
  if (memberships.some((membership) => membership.teamId !== teamId)) {
    throw new TeamPlayerMembershipIndexIncompleteError(teamId);
  }
  const observedPlayers = await readPlayers(
    database,
    memberships.map(({ playerId }) => playerId),
    "player_lookup",
    observe,
  );
  const aliasedPlayers = [...observedPlayers.values()].filter(
    (player) => player.externalProvider && player.externalProviderId,
  );
  const aliases = new Map<string, PlayerProviderAlias>();
  for (
    let offset = 0;
    offset < aliasedPlayers.length;
    offset += LOOKUP_BATCH_SIZE
  ) {
    const page = aliasedPlayers.slice(offset, offset + LOOKUP_BATCH_SIZE);
    const snapshots = await database.getAll(
      ...page.map((player) =>
        database.doc(
          `playerProviderAliases/${playerProviderAliasId(
            player.externalProvider!,
            player.externalProviderId!,
          )}`,
        ),
      ),
    );
    observe?.({ kind: "alias_lookup", documents: snapshots.length });
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) aliases.set(page[index].id, fromDocument(snapshot));
    });
  }
  const canonicalIds = memberships.map(
    ({ playerId }) => aliases.get(playerId)?.canonicalPlayerId ?? playerId,
  );
  const canonicalPlayers = await readPlayers(
    database,
    canonicalIds.filter((playerId) => !observedPlayers.has(playerId)),
    "canonical_player_lookup",
    observe,
  );
  const resolved = new Map<string, IndexedTeamPlayer>();
  const canonicalPlayerIds = new Map<string, string>();
  memberships.forEach((membership, index) => {
    const canonicalId = canonicalIds[index];
    canonicalPlayerIds.set(membership.playerId, canonicalId);
    const player =
      canonicalPlayers.get(canonicalId) ?? observedPlayers.get(canonicalId);
    if (!player) throw new TeamPlayerMembershipIndexIncompleteError(teamId);
    const canonicalMembership: TeamPlayerMembership = {
      ...membership,
      playerId: player.id,
      displayName: player.displayName,
      searchName: normalizePlayerSearch(player.displayName),
    };
    const current = resolved.get(player.id);
    resolved.set(player.id, {
      player,
      membership: mergeTeamPlayerMembership(
        current?.membership,
        canonicalMembership,
      ),
    });
  });
  return { players: [...resolved.values()], canonicalPlayerIds };
}

async function readPlayers(
  database: Firestore,
  playerIds: readonly string[],
  kind: "player_lookup" | "canonical_player_lookup",
  observe?: TeamPlayerIndexObserver,
): Promise<Map<string, Player>> {
  const players = new Map<string, Player>();
  const unique = [...new Set(playerIds)];
  for (let offset = 0; offset < unique.length; offset += LOOKUP_BATCH_SIZE) {
    const snapshots = await database.getAll(
      ...unique
        .slice(offset, offset + LOOKUP_BATCH_SIZE)
        .map((playerId) => database.doc(`players/${playerId}`)),
    );
    observe?.({ kind, documents: snapshots.length });
    for (const snapshot of snapshots) {
      if (snapshot.exists) players.set(snapshot.id, fromDocument(snapshot));
    }
  }
  return players;
}

function fromMembershipDocument(
  snapshot: QueryDocumentSnapshot,
): TeamPlayerMembership {
  return {
    ...(convertTimestamps(snapshot.data()) as Omit<
      TeamPlayerMembership,
      "playerId"
    >),
    playerId: snapshot.id,
  };
}

function fromDocument<T>(snapshot: {
  id: string;
  data(): DocumentData | undefined;
}): T {
  const data = snapshot.data();
  if (!data) throw new Error(`Document ${snapshot.id} has no data.`);
  return { ...convertTimestamps(data), id: snapshot.id } as T;
}

function convertTimestamps(data: DocumentData): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value instanceof Timestamp ? value.toDate().toISOString() : value,
    ]),
  );
}
