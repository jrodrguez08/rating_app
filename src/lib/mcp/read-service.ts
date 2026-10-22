import { FieldPath, Timestamp, type Firestore } from "firebase-admin/firestore";

import { initialClub } from "@/config/club";
import { hasAuthoritativeFinalWhistle } from "@/domain/manual-voting";
import type {
  Coach,
  CoachProviderAlias,
  Match,
  MatchResult,
} from "@/domain/models";
import { coachProviderAliasId } from "@/domain/coach-identity";
import { getMessages } from "@/i18n/messages";
import {
  AdminPlayerHistoryService,
  AdminResultService,
  getServerFirestore,
} from "@/lib/firebase/server";
import {
  readPublishedTeamHistory,
  searchIndexedTeamPlayers,
} from "@/lib/firebase/team-player-membership-index";

const MAX_PAGE_SIZE = 20;
const DEFAULT_PAGE_SIZE = 10;
const messages = getMessages("es").mcp;

export type MatchListKind = "recent" | "upcoming" | "completed" | "published";

export class McpReadService {
  constructor(
    private readonly database: Firestore = getServerFirestore(),
    private readonly teamId: string = initialClub.teamId,
  ) {}

  async listMatches(input: {
    kind: MatchListKind;
    limit?: number;
    cursor?: string;
    now?: Date;
  }) {
    const limit = boundedLimit(input.limit);
    const now = input.now ?? new Date();
    const direction = input.kind === "upcoming" ? "asc" : "desc";
    let query = this.database
      .collection("matches")
      .where("trackedTeamId", "==", this.teamId)
      .orderBy("kickoffAt", direction)
      .orderBy(FieldPath.documentId(), direction);
    if (input.kind === "published") {
      query = query.where("ratingState", "==", "rating_closed");
    }
    if (input.kind === "upcoming") {
      query = query.where("kickoffAt", ">=", Timestamp.fromDate(now));
    } else {
      query = query.where("kickoffAt", "<", Timestamp.fromDate(now));
    }
    const cursor = decodeMatchCursor(input.cursor);
    if (cursor) {
      query = query.startAfter(
        Timestamp.fromDate(new Date(cursor.kickoffAt)),
        cursor.id,
      );
    }

    const scanLimit = input.kind === "completed" ? limit * 5 + 1 : limit + 1;
    const snapshot = await query.limit(scanLimit).get();
    const observed = snapshot.docs.map((document) =>
      fromDocument<Match>(document),
    );
    const filtered = observed.filter((match) => {
      if (input.kind === "completed")
        return hasAuthoritativeFinalWhistle(match);
      if (input.kind === "published")
        return match.ratingState === "rating_closed";
      return true;
    });
    const page = filtered.slice(0, limit);
    const lastScanned = snapshot.docs.at(-1);
    const hasMore =
      filtered.length > limit ||
      (input.kind === "completed" && snapshot.size === scanLimit);
    const cursorDocument =
      input.kind === "completed" && filtered.length > limit
        ? snapshot.docs.find((document) => document.id === page.at(-1)?.id)
        : lastScanned;
    return {
      matches: page.map(compactMatch),
      ...(hasMore && cursorDocument
        ? {
            nextCursor: encodeMatchCursor(
              fromDocument<Match>(cursorDocument).kickoffAt,
              cursorDocument.id,
            ),
          }
        : {}),
    };
  }

  async getMatchResults(matchId: string) {
    const state = await new AdminResultService(this.database).getPageState(
      matchId,
    );
    if (state.state !== "ready") {
      return {
        availability: state.state,
        message:
          state.state === "locked"
            ? messages.matchResultsLocked
            : messages.matchResultsUnavailable,
      };
    }
    return {
      availability: "published" as const,
      match: compactMatch(state.match),
      result: compactResult(state.result),
    };
  }

  async searchPlayers(input: {
    query: string;
    limit?: number;
    cursor?: string;
  }) {
    const page = await searchIndexedTeamPlayers(
      this.database,
      this.teamId,
      input.query,
      input.cursor,
      undefined,
      boundedLimit(input.limit),
    );
    return {
      players: page.players.map(({ player, membership }) => ({
        playerId: player.id,
        name: player.displayName,
        ...(player.position ? { position: player.position } : {}),
        identitySource: player.identityProvenance ?? "provider",
        membershipSource: membership.source,
      })),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  async getPlayerStatistics(input: {
    playerId: string;
    limit?: number;
    cursor?: string;
  }) {
    const player = await new AdminPlayerHistoryService(this.database).get(
      input.playerId,
      this.teamId,
    );
    if (!player) return { availability: "not_found" as const };
    const offset = decodeOffset(input.cursor);
    const limit = boundedLimit(input.limit);
    const history = player.history.slice(offset, offset + limit);
    return {
      availability: "available" as const,
      player: {
        playerId: player.playerId,
        name: player.playerName,
        overallAverage: player.overallAverage,
        ratedMatchCount: player.ratedMatchCount,
        rank: player.rank,
        rankingMinimumMatches: 2,
      },
      matches: history,
      ...(offset + history.length < player.history.length
        ? { nextCursor: encodeOffset(offset + history.length) }
        : {}),
    };
  }

  async getCoachStatistics(input: {
    coachId: string;
    limit?: number;
    cursor?: string;
  }) {
    const history = await readPublishedTeamHistory(this.database, this.teamId);
    const coachIds = [
      ...new Set(history.results.map((result) => result.coachResult.coachId)),
    ];
    if (!coachIds.includes(input.coachId)) coachIds.push(input.coachId);
    const coachSnapshots = await this.database.getAll(
      ...coachIds.map((id) => this.database.doc(`coaches/${id}`)),
    );
    const coaches = new Map(
      coachSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => [snapshot.id, fromDocument<Coach>(snapshot)]),
    );
    const providerCoaches = [...coaches.values()].filter(
      (coach) => coach.externalProvider && coach.externalProviderId,
    );
    const aliasSnapshots = providerCoaches.length
      ? await this.database.getAll(
          ...providerCoaches.map((coach) =>
            this.database.doc(
              `coachProviderAliases/${coachProviderAliasId(
                coach.externalProvider!,
                coach.externalProviderId!,
              )}`,
            ),
          ),
        )
      : [];
    const canonical = new Map(coachIds.map((id) => [id, id]));
    aliasSnapshots.forEach((snapshot, index) => {
      if (snapshot.exists) {
        canonical.set(
          providerCoaches[index].id,
          fromDocument<CoachProviderAlias>(snapshot).canonicalCoachId,
        );
      }
    });
    const canonicalId = canonical.get(input.coachId) ?? input.coachId;
    if (!coaches.has(canonicalId)) {
      const canonicalSnapshot = await this.database
        .doc(`coaches/${canonicalId}`)
        .get();
      if (canonicalSnapshot.exists) {
        coaches.set(canonicalId, fromDocument<Coach>(canonicalSnapshot));
      }
    }
    const matchesById = new Map(
      history.matches.map((match) => [match.id, match]),
    );
    const ratings = history.results
      .filter(
        (result) =>
          result.status === "final" &&
          (canonical.get(result.coachResult.coachId) ??
            result.coachResult.coachId) === canonicalId &&
          matchesById.get(result.matchId)?.ratingState === "rating_closed",
      )
      .map((result) => ({
        matchId: result.matchId,
        kickoffAt: matchesById.get(result.matchId)!.kickoffAt,
        average: result.coachResult.average,
        voteCount: result.coachResult.voteCount,
      }))
      .sort((left, right) => right.kickoffAt.localeCompare(left.kickoffAt));
    const coach = coaches.get(canonicalId) ?? coaches.get(input.coachId);
    if (!coach && ratings.length === 0)
      return { availability: "not_found" as const };
    const offset = decodeOffset(input.cursor);
    const limit = boundedLimit(input.limit);
    const page = ratings.slice(offset, offset + limit);
    return {
      availability: "available" as const,
      coach: {
        coachId: canonicalId,
        name:
          coach?.displayName ??
          history.results.find(
            (result) => result.coachResult.coachId === input.coachId,
          )?.coachResult.coachName ??
          "Entrenador",
        ratedMatchCount: ratings.length,
        overallAverage:
          ratings.length === 0
            ? null
            : ratings.reduce((sum, rating) => sum + rating.average, 0) /
              ratings.length,
      },
      matches: page,
      limitation: messages.coachHistoryLimitation,
      ...(offset + page.length < ratings.length
        ? { nextCursor: encodeOffset(offset + page.length) }
        : {}),
    };
  }
}

function boundedLimit(limit?: number): number {
  return Math.min(
    Math.max(Math.trunc(limit ?? DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
}

function compactMatch(match: Match) {
  return {
    matchId: match.id,
    kickoffAt: match.kickoffAt,
    status: match.status,
    ratingState: match.ratingState,
    homeTeam: match.homeTeam.name,
    awayTeam: match.awayTeam.name,
    score: match.score,
    resultsPublished: match.ratingState === "rating_closed",
  };
}

function compactResult(result: MatchResult) {
  return {
    ballotCount: result.ballotCount,
    players: Object.values(result.playerResults)
      .sort((left, right) => left.order - right.order)
      .map(({ playerId, playerName, position, average, voteCount }) => ({
        playerId,
        name: playerName,
        ...(position ? { position } : {}),
        average,
        voteCount,
        isMvp: result.mvpPlayerIds.includes(playerId),
      })),
    coach: {
      coachId: result.coachResult.coachId,
      name: result.coachResult.coachName,
      average: result.coachResult.average,
      voteCount: result.coachResult.voteCount,
    },
    generatedAt: result.generatedAt,
  };
}

function fromDocument<T>(snapshot: {
  id: string;
  data(): FirebaseFirestore.DocumentData | undefined;
}): T {
  const data = snapshot.data();
  if (!data) throw new Error(`Missing Firestore document ${snapshot.id}.`);
  return normalizeTimestamps({ id: snapshot.id, ...data }) as T;
}

function normalizeTimestamps(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalizeTimestamps);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeTimestamps(item),
      ]),
    );
  }
  return value;
}

function encodeMatchCursor(kickoffAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ kickoffAt, id })).toString("base64url");
}

function decodeMatchCursor(
  value?: string,
): { kickoffAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString(),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const kickoffAt = "kickoffAt" in parsed ? parsed.kickoffAt : undefined;
    const id = "id" in parsed ? parsed.id : undefined;
    if (
      typeof kickoffAt !== "string" ||
      Number.isNaN(Date.parse(kickoffAt)) ||
      typeof id !== "string"
    )
      return null;
    return { kickoffAt, id };
  } catch {
    return null;
  }
}

function encodeOffset(offset: number): string {
  return Buffer.from(String(offset)).toString("base64url");
}

function decodeOffset(value?: string): number {
  if (!value) return 0;
  const offset = Number(Buffer.from(value, "base64url").toString());
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}
