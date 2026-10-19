import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import {
  FieldPath,
  type DocumentData,
  type Firestore,
  getFirestore,
  type Query,
  type QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";

import {
  membershipFromParticipant,
  membershipFromPlayer,
  mergeTeamPlayerMembership,
} from "../src/application/team-player-membership";
import initialTeam from "../firebase/seed/initial-team.json";
import { canonicalPlayerIdMap } from "../src/domain/player-identity";
import {
  normalizePlayerSearch,
  playerSearchPrefixes,
} from "../src/domain/player-search";
import type {
  Match,
  MatchParticipant,
  Player,
  PlayerProviderAlias,
  TeamPlayerMembership,
  VerifiedLineupSnapshot,
} from "../src/domain/models";
import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";

const DEFAULT_PAGE_SIZE = 100;
const WRITE_BATCH_SIZE = 400;
const PLAYER_LOOKUP_SIZE = 100;

export interface MembershipBackfillArguments {
  projectId: string;
  teamId: string;
  apply: boolean;
}

export interface MembershipBackfillTelemetry {
  playersScanned: number;
  matchesScanned: number;
  participantsScanned: number;
  verifiedLineupsScanned: number;
  aliasesScanned: number;
  existingMemberships: number;
  newMemberships: number;
  updatedMemberships: number;
  unchangedMemberships: number;
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
  finalUniqueMembershipCount: number;
  writes: number;
  plannedChanges: Array<{
    playerId: string;
    displayName: string;
    source: TeamPlayerMembership["source"];
    disposition: "create" | "update";
  }>;
}

interface MembershipEvidence {
  membership: TeamPlayerMembership;
  canonicalPlayerId: string;
}

export function parseMembershipBackfillArguments(
  arguments_: readonly string[],
): MembershipBackfillArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value) throw usageError();
    values.set(key, value);
  }
  const projectId = values.get("--project-id");
  const teamId = values.get("--team-id") ?? initialTeam.id;
  const applyValue = values.get("--apply");
  const apply = applyValue === "true";
  const allowed = new Set([
    "--project-id",
    "--team-id",
    "--apply",
    "--confirm",
  ]);
  if (
    !projectId ||
    (applyValue !== undefined && applyValue !== "true") ||
    [...values.keys()].some((key) => !allowed.has(key))
  ) {
    throw usageError();
  }
  if (projectId.startsWith("demo-")) {
    throw new Error("Production membership backfill rejects demo-* projects.");
  }
  if (
    apply &&
    values.get("--confirm") !== `backfill-team-player-memberships:${teamId}`
  ) {
    throw usageError();
  }
  if (!apply && values.has("--confirm")) throw usageError();
  return { projectId, teamId, apply };
}

export async function main() {
  const arguments_ = parseMembershipBackfillArguments(process.argv.slice(2));
  const config = readFirebaseAdminRuntimeConfig();
  if (config.environment !== "production" || config.emulator) {
    throw new Error(
      "Membership backfill requires production mode without emulators.",
    );
  }
  if (config.projectId !== arguments_.projectId) {
    throw new Error("The confirmed project ID does not match Firebase Admin.");
  }
  const app = initializeApp(
    {
      projectId: config.projectId,
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail!,
        privateKey: config.privateKey!,
      }),
    },
    `team-player-membership-backfill-${Date.now()}`,
  );
  try {
    const telemetry = await runMembershipBackfill(
      getFirestore(app),
      arguments_.teamId,
      arguments_.apply,
    );
    console.log(
      JSON.stringify({
        operation: "team-player-membership-backfill",
        mode: arguments_.apply ? "apply" : "dry-run",
        projectId: arguments_.projectId,
        teamId: arguments_.teamId,
        ...telemetry,
      }),
    );
  } finally {
    await deleteApp(app);
  }
}

export async function runMembershipBackfill(
  database: Firestore,
  teamId: string,
  apply: boolean,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<MembershipBackfillTelemetry> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new Error("Backfill page size must be between 1 and 500.");
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
  for (const snapshot of membershipDocuments) {
    const membership = fromMembershipDocument(snapshot);
    existing.set(snapshot.id, membership);
    if (membership.teamId !== teamId) {
      incrementSkip(telemetry, "wrong_team_membership");
    }
  }

  const evidence: MembershipEvidence[] = [];
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
  const verifiedByMatch = new Map<string, VerifiedLineupSnapshot>();
  for (
    let offset = 0;
    offset < matchDocuments.length;
    offset += PLAYER_LOOKUP_SIZE
  ) {
    telemetry.pages.verifiedLineups += 1;
    const matches = matchDocuments.slice(offset, offset + PLAYER_LOOKUP_SIZE);
    let snapshots;
    try {
      snapshots = await database.getAll(
        ...matches.map((match) =>
          database.doc(`matches/${match.id}/verifiedLineups/current`),
        ),
      );
    } catch (error) {
      throw pageReadError(
        "verified lineup lookups",
        telemetry.pages.verifiedLineups,
        error,
      );
    }
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      telemetry.verifiedLineupsScanned += 1;
      verifiedByMatch.set(
        matches[index].id,
        fromDocument<VerifiedLineupSnapshot>(snapshot),
      );
    });
  }
  for (const matchDocument of matchDocuments) {
    const match = fromDocument<Match>(matchDocument);
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
      const membership: TeamPlayerMembership = {
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
      };
      evidence.push({
        membership,
        canonicalPlayerId: resolveCanonicalId(
          participant.playerId,
          verified.externalProvider,
          participant.externalProviderPlayerId,
        ),
      });
    }
  }

  for (const membership of existing.values()) {
    const canonicalPlayerId = resolveCanonicalId(membership.playerId);
    evidence.push({ membership, canonicalPlayerId });
  }

  const playerIds = [
    ...new Set(evidence.map(({ canonicalPlayerId }) => canonicalPlayerId)),
  ];
  const players = new Map<string, Player>();
  for (
    let offset = 0;
    offset < playerIds.length;
    offset += PLAYER_LOOKUP_SIZE
  ) {
    telemetry.pages.playerLookups += 1;
    const references = playerIds
      .slice(offset, offset + PLAYER_LOOKUP_SIZE)
      .map((playerId) => database.doc(`players/${playerId}`));
    let snapshots;
    try {
      snapshots = await database.getAll(...references);
    } catch (error) {
      throw pageReadError(
        "canonical Player lookups",
        telemetry.pages.playerLookups,
        error,
      );
    }
    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        const player = fromDocument<Player>(snapshot);
        players.set(player.id, player);
        scannedPlayerIds.add(player.id);
      }
    }
  }

  for (const item of evidence) {
    const observed = players.get(item.canonicalPlayerId);
    if (!observed) continue;
    item.canonicalPlayerId = resolveCanonicalId(
      observed.id,
      observed.externalProvider,
      observed.externalProviderId,
    );
  }
  const missingCanonicalPlayerIds = [
    ...new Set(
      evidence
        .map(({ canonicalPlayerId }) => canonicalPlayerId)
        .filter((playerId) => !players.has(playerId)),
    ),
  ];
  for (
    let offset = 0;
    offset < missingCanonicalPlayerIds.length;
    offset += PLAYER_LOOKUP_SIZE
  ) {
    telemetry.pages.playerLookups += 1;
    const references = missingCanonicalPlayerIds
      .slice(offset, offset + PLAYER_LOOKUP_SIZE)
      .map((playerId) => database.doc(`players/${playerId}`));
    let snapshots;
    try {
      snapshots = await database.getAll(...references);
    } catch (error) {
      throw pageReadError(
        "alias-resolved canonical Player lookups",
        telemetry.pages.playerLookups,
        error,
      );
    }
    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        const player = fromDocument<Player>(snapshot);
        players.set(player.id, player);
        scannedPlayerIds.add(player.id);
      }
    }
  }

  const proposed = new Map(existing);
  const unresolvedPlayerIds = new Set<string>();
  for (const item of evidence) {
    const player = players.get(item.canonicalPlayerId);
    if (!player) {
      unresolvedPlayerIds.add(item.canonicalPlayerId);
      incrementSkip(telemetry, "canonical_player_missing");
      continue;
    }
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

  const changed = [...proposed.values()].filter((membership) => {
    const current = existing.get(membership.playerId);
    if (!current) {
      telemetry.newMemberships += 1;
      telemetry.plannedChanges.push({
        playerId: membership.playerId,
        displayName: membership.displayName,
        source: membership.source,
        disposition: "create",
      });
      return true;
    }
    if (!isDeepStrictEqual(current, membership)) {
      telemetry.updatedMemberships += 1;
      telemetry.plannedChanges.push({
        playerId: membership.playerId,
        displayName: membership.displayName,
        source: membership.source,
        disposition: "update",
      });
      return true;
    }
    telemetry.unchangedMemberships += 1;
    return false;
  });
  telemetry.playersScanned = scannedPlayerIds.size;
  telemetry.unresolvedIdentities = unresolvedPlayerIds.size;
  telemetry.finalUniqueMembershipCount = proposed.size;
  telemetry.writes = apply ? changed.length : 0;
  if (apply) await writeMemberships(database, teamId, changed);
  return telemetry;
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

async function writeMemberships(
  database: Firestore,
  teamId: string,
  memberships: readonly TeamPlayerMembership[],
) {
  for (
    let offset = 0;
    offset < memberships.length;
    offset += WRITE_BATCH_SIZE
  ) {
    const batch = database.batch();
    for (const membership of memberships.slice(
      offset,
      offset + WRITE_BATCH_SIZE,
    )) {
      batch.set(
        database.doc(
          `teams/${teamId}/playerMemberships/${membership.playerId}`,
        ),
        toDocument(membership),
        { merge: true },
      );
    }
    await batch.commit();
  }
}

function emptyTelemetry(): MembershipBackfillTelemetry {
  return {
    playersScanned: 0,
    matchesScanned: 0,
    participantsScanned: 0,
    verifiedLineupsScanned: 0,
    aliasesScanned: 0,
    existingMemberships: 0,
    newMemberships: 0,
    updatedMemberships: 0,
    unchangedMemberships: 0,
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
    finalUniqueMembershipCount: 0,
    writes: 0,
    plannedChanges: [],
  };
}

function incrementSkip(telemetry: MembershipBackfillTelemetry, reason: string) {
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

function toDocument(value: TeamPlayerMembership): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [
        key,
        key.endsWith("At") && typeof item === "string"
          ? Timestamp.fromDate(new Date(item))
          : item,
      ]),
  );
}

function pageReadError(label: string, page: number, error: unknown) {
  const reason = error instanceof Error ? error.message : "unknown error";
  return new Error(`Failed to read ${label} page ${page}: ${reason}`);
}

function usageError() {
  return new Error(
    "Usage: npm run backfill:team-player-memberships -- --project-id <project> [--team-id <team>] [--apply true --confirm backfill-team-player-memberships:<team>]",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Membership backfill failed.",
    );
    process.exitCode = 1;
  });
}
