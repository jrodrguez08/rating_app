import { isDeepStrictEqual } from "node:util";

import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import {
  membershipFromParticipant,
  membershipFromPlayer,
  mergeTeamPlayerMembership,
} from "@/application/team-player-membership";
import type {
  Match,
  MatchParticipant,
  Player,
  PlayerProviderAlias,
  TeamPlayerMembership,
  VerifiedLineupSnapshot,
} from "@/domain/models";
import { canonicalPlayerIdMap } from "@/domain/player-identity";
import {
  normalizePlayerSearch,
  playerSearchPrefixes,
} from "@/domain/player-search";

export const TEAM_PLAYER_DISCOVERY_PAGE_SIZE = 100;
const LOOKUP_BATCH_SIZE = 100;

export interface TeamPlayerDiscoveryTelemetry {
  playersScanned: number;
  matchesScanned: number;
  participantsScanned: number;
  verifiedLineupsScanned: number;
  aliasesScanned: number;
  existingMemberships: number;
  unresolvedIdentities: number;
  skippedByReason: Record<string, number>;
  pages: {
    players: number;
    matches: number;
    participants: number;
    verifiedLineups: number;
    aliases: number;
    memberships: number;
    playerLookups: number;
  };
}

export interface DiscoveredTeamPlayer {
  player: Player;
  membership: TeamPlayerMembership;
  searchPrefixes: readonly string[];
}

export interface TeamPlayerDiscovery {
  matches: Match[];
  aliases: PlayerProviderAlias[];
  canonicalPlayerIds: ReadonlyMap<string, string>;
  players: DiscoveredTeamPlayer[];
  existingMemberships: ReadonlyMap<string, TeamPlayerMembership>;
  proposedMemberships: ReadonlyMap<string, TeamPlayerMembership>;
  telemetry: TeamPlayerDiscoveryTelemetry;
}

interface MembershipEvidence {
  membership: TeamPlayerMembership;
  canonicalPlayerId: string;
}

export async function discoverTeamPlayers(
  database: Firestore,
  teamId: string,
  pageSize = TEAM_PLAYER_DISCOVERY_PAGE_SIZE,
): Promise<TeamPlayerDiscovery> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new Error("Player discovery page size must be between 1 and 500.");
  }
  const telemetry = emptyTelemetry();
  const scannedPlayerIds = new Set<string>();
  const aliasDocuments = await readAllQueryPages(
    database.collection("playerProviderAliases"),
    "player aliases",
    pageSize,
    (documents) => {
      telemetry.pages.aliases += 1;
      telemetry.aliasesScanned += documents.length;
    },
  );
  const aliases = aliasDocuments.map((snapshot) =>
    fromDocument<PlayerProviderAlias>(snapshot),
  );
  const canonicalIds = canonicalPlayerIdMap(aliases);
  const canonicalByProviderIdentity = new Map(
    aliases.map((alias) => [
      `${alias.externalProvider}:${alias.externalProviderPlayerId}`,
      alias.canonicalPlayerId,
    ]),
  );
  const resolveCanonicalId = (
    playerId: string,
    provider?: string,
    externalPlayerId?: string,
  ) =>
    (provider && externalPlayerId
      ? canonicalByProviderIdentity.get(`${provider}:${externalPlayerId}`)
      : undefined) ??
    canonicalIds.get(playerId) ??
    playerId;

  const membershipDocuments = await readAllQueryPages(
    database.collection(`teams/${teamId}/playerMemberships`),
    "existing memberships",
    pageSize,
    (documents) => {
      telemetry.pages.memberships += 1;
      telemetry.existingMemberships += documents.length;
    },
  );
  const existing = new Map<string, TeamPlayerMembership>();
  const evidence: MembershipEvidence[] = [];
  for (const snapshot of membershipDocuments) {
    const membership = fromMembershipDocument(snapshot);
    existing.set(snapshot.id, membership);
    if (membership.teamId !== teamId) {
      incrementSkip(telemetry, "wrong_team_membership");
      continue;
    }
    evidence.push({
      membership,
      canonicalPlayerId: resolveCanonicalId(membership.playerId),
    });
  }

  const playerDocuments = await readAllQueryPages(
    database.collection("players").where("currentTeamId", "==", teamId),
    "current Team players",
    pageSize,
    (documents) => {
      telemetry.pages.players += 1;
      documents.forEach(({ id }) => scannedPlayerIds.add(id));
    },
  );
  for (const snapshot of playerDocuments) {
    const player = fromDocument<Player>(snapshot);
    const membership = membershipFromPlayer(player, player.updatedAt);
    if (!membership) {
      incrementSkip(telemetry, "missing_current_team");
      continue;
    }
    evidence.push({
      membership,
      canonicalPlayerId: resolveCanonicalId(
        player.id,
        player.externalProvider,
        player.externalProviderId,
      ),
    });
  }

  const matchDocuments = await readAllQueryPages(
    database.collection("matches").where("trackedTeamId", "==", teamId),
    "tracked Team matches",
    pageSize,
    (documents) => {
      telemetry.pages.matches += 1;
      telemetry.matchesScanned += documents.length;
    },
  );
  const matches = matchDocuments.map((snapshot) =>
    fromDocument<Match>(snapshot),
  );
  const verifiedByMatch = new Map<string, VerifiedLineupSnapshot>();
  for (let offset = 0; offset < matches.length; offset += LOOKUP_BATCH_SIZE) {
    telemetry.pages.verifiedLineups += 1;
    const page = matches.slice(offset, offset + LOOKUP_BATCH_SIZE);
    const snapshots = await readDocumentBatch(
      database,
      page.map((match) =>
        database.doc(`matches/${match.id}/verifiedLineups/current`),
      ),
      "verified lineup lookups",
      telemetry.pages.verifiedLineups,
    );
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      telemetry.verifiedLineupsScanned += 1;
      verifiedByMatch.set(
        page[index].id,
        fromDocument<VerifiedLineupSnapshot>(snapshot),
      );
    });
  }

  for (const match of matches) {
    const participantDocuments = await readAllQueryPages(
      database.collection(`matches/${match.id}/participants`),
      `participants for match ${match.id}`,
      pageSize,
      (documents) => {
        telemetry.pages.participants += 1;
        telemetry.participantsScanned += documents.length;
      },
    );
    for (const participantDocument of participantDocuments) {
      const participant = fromDocument<MatchParticipant>(participantDocument);
      if (participant.matchId !== match.id) {
        incrementSkip(telemetry, "participant_match_mismatch");
        continue;
      }
      if (participant.teamId !== teamId) {
        incrementSkip(telemetry, "opponent_participant");
        continue;
      }
      evidence.push({
        membership: membershipFromParticipant(participant),
        canonicalPlayerId: resolveCanonicalId(
          participant.playerId,
          participant.externalProvider,
          participant.externalProviderPlayerId,
        ),
      });
    }

    const verified = verifiedByMatch.get(match.id);
    if (!verified) continue;
    if (
      verified.matchId !== match.id ||
      verified.trackedTeamId !== teamId ||
      verified.externalFixtureId !== match.externalProviderFixtureId
    ) {
      throw new Error(
        `Verified lineup binding is invalid for match ${match.id}.`,
      );
    }
    for (const participant of verified.participants) {
      const observedAt = participant.verifiedAt || verified.verifiedAt;
      evidence.push({
        membership: {
          playerId: participant.playerId,
          teamId,
          displayName: participant.playerName,
          searchName: normalizePlayerSearch(participant.playerName),
          searchPrefixes: playerSearchPrefixes(participant.playerName),
          source: "operator_verified",
          sourceMatchId: match.id,
          ...(participant.shirtNumber === undefined
            ? {}
            : { shirtNumber: participant.shirtNumber }),
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          createdAt: observedAt,
          updatedAt: observedAt,
        },
        canonicalPlayerId: resolveCanonicalId(
          participant.playerId,
          verified.externalProvider,
          participant.externalProviderPlayerId,
        ),
      });
    }
  }

  const players = new Map<string, Player>();
  await loadPlayers(
    database,
    [...new Set(evidence.map(({ canonicalPlayerId }) => canonicalPlayerId))],
    players,
    scannedPlayerIds,
    telemetry,
    "canonical Player lookups",
  );
  for (const item of evidence) {
    const observed = players.get(item.canonicalPlayerId);
    if (!observed) continue;
    item.canonicalPlayerId = resolveCanonicalId(
      observed.id,
      observed.externalProvider,
      observed.externalProviderId,
    );
  }
  await loadPlayers(
    database,
    [
      ...new Set(
        evidence
          .map(({ canonicalPlayerId }) => canonicalPlayerId)
          .filter((playerId) => !players.has(playerId)),
      ),
    ],
    players,
    scannedPlayerIds,
    telemetry,
    "alias-resolved canonical Player lookups",
  );

  const proposed = new Map(existing);
  const resolvedCanonicalIds = new Map(canonicalIds);
  const searchPrefixesByCanonicalId = new Map<string, Set<string>>();
  const unresolvedPlayerIds = new Set<string>();
  for (const item of evidence) {
    resolvedCanonicalIds.set(item.membership.playerId, item.canonicalPlayerId);
    const player = players.get(item.canonicalPlayerId);
    if (!player) {
      unresolvedPlayerIds.add(item.canonicalPlayerId);
      incrementSkip(telemetry, "canonical_player_missing");
      continue;
    }
    const prefixes = searchPrefixesByCanonicalId.get(player.id) ?? new Set();
    item.membership.searchPrefixes.forEach((prefix) => prefixes.add(prefix));
    playerSearchPrefixes(player.displayName).forEach((prefix) =>
      prefixes.add(prefix),
    );
    searchPrefixesByCanonicalId.set(player.id, prefixes);
    const incoming: TeamPlayerMembership = {
      ...item.membership,
      playerId: player.id,
      teamId,
      displayName: player.displayName,
      searchName: normalizePlayerSearch(player.displayName),
      searchPrefixes: playerSearchPrefixes(player.displayName),
    };
    proposed.set(
      player.id,
      mergeTeamPlayerMembership(proposed.get(player.id), incoming),
    );
  }

  telemetry.playersScanned = scannedPlayerIds.size;
  telemetry.unresolvedIdentities = unresolvedPlayerIds.size;
  const discovered = [...searchPrefixesByCanonicalId].flatMap(
    ([playerId, prefixes]) => {
      const player = players.get(playerId);
      const membership = proposed.get(playerId);
      return player && membership
        ? [{ player, membership, searchPrefixes: [...prefixes].sort() }]
        : [];
    },
  );
  discovered.sort((left, right) =>
    left.player.id.localeCompare(right.player.id),
  );
  return {
    matches,
    aliases,
    canonicalPlayerIds: resolvedCanonicalIds,
    players: discovered,
    existingMemberships: existing,
    proposedMemberships: proposed,
    telemetry,
  };
}

export function changedMemberships(discovery: TeamPlayerDiscovery): {
  changed: TeamPlayerMembership[];
  created: number;
  updated: number;
  unchanged: number;
} {
  const changed: TeamPlayerMembership[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const membership of discovery.proposedMemberships.values()) {
    const current = discovery.existingMemberships.get(membership.playerId);
    if (!current) created += 1;
    else if (!isDeepStrictEqual(current, membership)) updated += 1;
    else {
      unchanged += 1;
      continue;
    }
    changed.push(membership);
  }
  return { changed, created, updated, unchanged };
}

export async function readAllQueryPages(
  query: Query,
  label: string,
  pageSize: number,
  onPage: (documents: QueryDocumentSnapshot[]) => void,
): Promise<QueryDocumentSnapshot[]> {
  const documents: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  let page = 0;
  while (true) {
    page += 1;
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    let snapshot;
    try {
      snapshot = await pageQuery.get();
    } catch (error) {
      throw pageReadError(label, page, error);
    }
    onPage(snapshot.docs);
    documents.push(...snapshot.docs);
    if (snapshot.size < pageSize) return documents;
    cursor = snapshot.docs.at(-1);
    if (!cursor) return documents;
  }
}

async function loadPlayers(
  database: Firestore,
  playerIds: readonly string[],
  players: Map<string, Player>,
  scannedPlayerIds: Set<string>,
  telemetry: TeamPlayerDiscoveryTelemetry,
  label: string,
) {
  for (let offset = 0; offset < playerIds.length; offset += LOOKUP_BATCH_SIZE) {
    telemetry.pages.playerLookups += 1;
    const snapshots = await readDocumentBatch(
      database,
      playerIds
        .slice(offset, offset + LOOKUP_BATCH_SIZE)
        .map((playerId) => database.doc(`players/${playerId}`)),
      label,
      telemetry.pages.playerLookups,
    );
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const player = fromDocument<Player>(snapshot);
      players.set(player.id, player);
      scannedPlayerIds.add(player.id);
    }
  }
}

async function readDocumentBatch(
  database: Firestore,
  references: Parameters<Firestore["getAll"]>,
  label: string,
  page: number,
) {
  try {
    return await database.getAll(...references);
  } catch (error) {
    throw pageReadError(label, page, error);
  }
}

function emptyTelemetry(): TeamPlayerDiscoveryTelemetry {
  return {
    playersScanned: 0,
    matchesScanned: 0,
    participantsScanned: 0,
    verifiedLineupsScanned: 0,
    aliasesScanned: 0,
    existingMemberships: 0,
    unresolvedIdentities: 0,
    skippedByReason: {},
    pages: {
      players: 0,
      matches: 0,
      participants: 0,
      verifiedLineups: 0,
      aliases: 0,
      memberships: 0,
      playerLookups: 0,
    },
  };
}

function incrementSkip(
  telemetry: TeamPlayerDiscoveryTelemetry,
  reason: string,
) {
  telemetry.skippedByReason[reason] =
    (telemetry.skippedByReason[reason] ?? 0) + 1;
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

function pageReadError(label: string, page: number, error: unknown) {
  const reason = error instanceof Error ? error.message : "unknown error";
  return new Error(`Failed to read ${label} page ${page}: ${reason}`);
}
