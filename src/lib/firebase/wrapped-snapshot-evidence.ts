import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";

import {
  evaluateWrappedCoverage,
  wrappedScopeVerified,
} from "@/application/wrapped-coverage";
import { parseWrappedLedger } from "@/application/wrapped-ledger";
import { MAX_PUBLISHED_RESULT_PLAYERS } from "@/application/published-result-podium";
import {
  WRAPPED_ALGORITHM,
  WRAPPED_SNAPSHOT_SCHEMA,
  WrappedSnapshotError,
  canonicalJson,
  wrappedProjection,
  wrappedSnapshotHash,
} from "@/application/wrapped-snapshot";
import {
  calculateWrappedStatistics,
  WRAPPED_PILOT_POLICY,
} from "@/application/wrapped-statistics";
import type { WrappedMatchSource } from "@/application/wrapped-statistics-input";
import { coachProviderAliasId } from "@/domain/coach-identity";
import type {
  Coach,
  CoachAssignment,
  CoachProviderAlias,
  Competition,
  Match,
  MatchParticipant,
  MatchResult,
  Player,
  PlayerProviderAlias,
  Season,
  Team,
} from "@/domain/models";
import { playerProviderAliasId } from "@/domain/player-identity";
import { fromDocument } from "@/lib/firebase/firestore-document";

const MAX_FIXTURES = 64;
const MAX_PARTICIPANTS = 32;
const MAX_IDENTITY_IDS = 512;

export function parseSnapshotLedger(raw: unknown, teamId: string, key: string) {
  let ledger;
  try {
    ledger = parseWrappedLedger(raw);
  } catch {
    throw new WrappedSnapshotError("invalid_input");
  }
  const tournament = ledger.tournaments.find((entry) => entry.key === key);
  if (ledger.teamId !== teamId || !tournament)
    throw new WrappedSnapshotError("invalid_input");
  if (tournament.fixtures.length > MAX_FIXTURES)
    throw new WrappedSnapshotError("oversized_evidence");
  return { ledger, tournament };
}

function safeId(id: string) {
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))
    throw new WrappedSnapshotError("invalid_input");
  return id;
}

function value<T>(snapshot: DocumentSnapshot): T | undefined {
  return snapshot.exists ? fromDocument<T>(snapshot) : undefined;
}

export async function loadWrappedCandidate(
  database: Firestore,
  transaction: Transaction,
  input: ReturnType<typeof parseSnapshotLedger>,
) {
  const { ledger, tournament } = input;
  const revisions = new Map<string, string | null>();
  function track(snapshot: DocumentSnapshot) {
    const time = snapshot.updateTime;
    revisions.set(
      snapshot.ref.path,
      time
        ? `${time.seconds}.${String(time.nanoseconds).padStart(9, "0")}`
        : null,
    );
  }
  async function read(references: DocumentReference[]) {
    const snapshots: DocumentSnapshot[] = [];
    for (let offset = 0; offset < references.length; offset += 50) {
      const batch = await transaction.getAll(
        ...references.slice(offset, offset + 50),
      );
      batch.forEach(track);
      snapshots.push(...batch);
    }
    return snapshots;
  }

  const [team, competition, season] = await read([
    database.doc(`teams/${ledger.teamId}`),
    database.doc(`competitions/${tournament.competitionId}`),
    database.doc(`seasons/${tournament.seasonId}`),
  ]);
  const scope = {
    team: value<Team>(team),
    competition: value<Competition>(competition),
    season: value<Season>(season),
  };
  if (!wrappedScopeVerified(ledger.teamId, tournament, scope))
    throw new WrappedSnapshotError("invalid_input");
  const asOf = team.readTime.toDate();
  const matchDocs = await read(
    tournament.fixtures.map(({ matchId }) =>
      database.doc(`matches/${matchId}`),
    ),
  );
  const summaryDocs = await read(
    tournament.fixtures.map(({ matchId }) =>
      database.doc(`matches/${matchId}/results/summary`),
    ),
  );
  const matches = new Map<string, Match>();
  const summaries = new Map<string, MatchResult>();
  const sources = new Map<string, WrappedMatchSource>();
  for (const [index, fixture] of tournament.fixtures.entries()) {
    const match = value<Match>(matchDocs[index]);
    const summary = value<MatchResult>(summaryDocs[index]);
    if (
      summary &&
      (!match ||
        fixture.disposition !== "expected" ||
        Object.keys(summary.playerResults ?? {}).length >
          MAX_PUBLISHED_RESULT_PLAYERS)
    )
      throw new WrappedSnapshotError("invalid_input");
    if (!match) continue;
    matches.set(fixture.matchId, match);
    if (summary) summaries.set(fixture.matchId, summary);
    sources.set(fixture.matchId, {
      match,
      ...(summary
        ? {
            currentResult: {
              summary,
              reopenCount: match.votingReopenCount ?? 0,
            },
          }
        : {}),
    });
  }
  const coverage = evaluateWrappedCoverage({
    ledger,
    tournament,
    scope,
    matches,
    summaries,
    asOf,
  });
  if (!coverage.coverageComplete)
    throw new WrappedSnapshotError("stale_candidate");
  const playerIds = new Set<string>();
  const coachIds = new Set<string>();
  for (const fixture of coverage.fixtures) {
    if (fixture.observation.status !== "rated") continue;
    const source = sources.get(fixture.matchId)!;
    const summary = source.currentResult!.summary;
    for (const row of Object.values(summary.playerResults))
      playerIds.add(safeId(row.playerId));
    coachIds.add(safeId(summary.coachResult.coachId));
    const [coachDoc] = await read([
      database.doc(`matches/${fixture.matchId}/coachAssignments/head-coach`),
    ]);
    source.coach = value<CoachAssignment>(coachDoc);
    if (source.coach) coachIds.add(safeId(source.coach.coachId));
    const participants = await transaction.get(
      database
        .collection(`matches/${fixture.matchId}/participants`)
        .limit(MAX_PARTICIPANTS + 1),
    );
    if (participants.size > MAX_PARTICIPANTS)
      throw new WrappedSnapshotError("oversized_evidence");
    participants.docs.forEach(track);
    source.participants = participants.docs.map((snapshot) => {
      const participant = fromDocument<MatchParticipant>(snapshot);
      playerIds.add(safeId(participant.playerId));
      return participant;
    });
  }

  async function identities<
    T extends Player | Coach,
    A extends PlayerProviderAlias | CoachProviderAlias,
  >(
    ids: Set<string>,
    collection: string,
    aliasCollection: string,
    aliasId: (provider: string, id: string) => string,
    targetId: (alias: A) => string,
  ) {
    if (ids.size > MAX_IDENTITY_IDS)
      throw new WrappedSnapshotError("oversized_evidence");
    const records = (
      await read([...ids].map((id) => database.doc(`${collection}/${id}`)))
    ).flatMap((snapshot) => value<T>(snapshot) ?? []);
    const seenAliases = new Set<string>();
    async function aliasesFor(records: T[]) {
      const refs = records.flatMap((record) => {
        if (!record.externalProvider || !record.externalProviderId) return [];
        const id = aliasId(record.externalProvider, record.externalProviderId);
        if (seenAliases.has(id)) return [];
        seenAliases.add(id);
        return [database.doc(`${aliasCollection}/${id}`)];
      });
      return (await read(refs)).flatMap((snapshot) => value<A>(snapshot) ?? []);
    }
    const aliases = await aliasesFor(records);
    const targets = [
      ...new Set(aliases.map((alias) => safeId(targetId(alias)))),
    ].filter((id) => !ids.has(id));
    const targetRecords = (
      await read(targets.map((id) => database.doc(`${collection}/${id}`)))
    ).flatMap((snapshot) => value<T>(snapshot) ?? []);
    const targetAliases = await aliasesFor(targetRecords);
    const known = new Set([...records, ...targetRecords].map(({ id }) => id));
    if (
      [...aliases, ...targetAliases].some(
        (alias) => !known.has(targetId(alias)),
      )
    )
      throw new WrappedSnapshotError("invalid_input");
    return {
      records: [...records, ...targetRecords],
      aliases: [...aliases, ...targetAliases],
    };
  }

  const players = await identities<Player, PlayerProviderAlias>(
    playerIds,
    "players",
    "playerProviderAliases",
    playerProviderAliasId,
    (alias) => alias.canonicalPlayerId,
  );
  const coaches = await identities<Coach, CoachProviderAlias>(
    coachIds,
    "coaches",
    "coachProviderAliases",
    coachProviderAliasId,
    (alias) => alias.canonicalCoachId,
  );
  const candidate = calculateWrappedStatistics({
    ledger: { version: 1, ...ledger },
    tournamentKey: tournament.key,
    scope,
    asOf,
    sources: [...sources.values()],
    players: players.records,
    playerAliases: players.aliases,
    coaches: coaches.records,
    coachAliases: coaches.aliases,
    policy: WRAPPED_PILOT_POLICY,
  });
  const projection = wrappedProjection(candidate);
  const manifest = canonicalJson({
    schema: WRAPPED_SNAPSHOT_SCHEMA,
    algorithm: WRAPPED_ALGORITHM,
    clubSlug: ledger.clubSlug,
    teamId: ledger.teamId,
    tournament,
    policy: candidate.policy,
    sources: candidate.references,
    revisions: Object.fromEntries(revisions),
  });
  const projectionJson = canonicalJson(projection);
  if (
    Buffer.byteLength(manifest) > 700_000 ||
    Buffer.byteLength(projectionJson) > 128_000
  )
    throw new WrappedSnapshotError("oversized_evidence");
  return {
    digest: wrappedSnapshotHash([manifest, projectionJson]),
    manifest,
    projection,
    projectionJson,
  };
}
