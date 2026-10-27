import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { MAX_STUDIO_MATCH_OPTIONS } from "@/application/studio";
import type { Match, MatchResult } from "@/domain/models";

import { AdminStudioService } from "./server";

describe("AdminStudioService", () => {
  it("reads a bounded newest-first catalog and excludes non-current results", async () => {
    const validMatch = match("published", "rating_closed");
    const reopenedMatch = match("reopened", "rating_ready");
    const resultSnapshots = [
      resultSnapshot(validMatch, result(validMatch)),
      resultSnapshot(reopenedMatch, result(reopenedMatch)),
    ];
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn(async () => ({ docs: resultSnapshots })),
    };
    const database = {
      collectionGroup: vi.fn(() => query),
      getAll: vi.fn(async () => [
        snapshot(validMatch),
        snapshot(reopenedMatch),
      ]),
    } as unknown as Firestore;

    const catalog = await new AdminStudioService(database).listPublishedMatches(
      "team-1",
    );

    expect(query.where).toHaveBeenNthCalledWith(1, "teamId", "==", "team-1");
    expect(query.where).toHaveBeenNthCalledWith(2, "status", "==", "final");
    expect(query.orderBy).toHaveBeenCalledWith("generatedAt", "desc");
    expect(query.limit).toHaveBeenCalledWith(MAX_STUDIO_MATCH_OPTIONS);
    expect(catalog).toEqual([
      expect.objectContaining({
        matchId: "published",
        score: { home: 2, away: 1 },
      }),
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/ballot|voter/i);
  });
});

function match(id: string, ratingState: Match["ratingState"]): Match {
  return {
    id,
    trackedTeamId: "team-1",
    competitionId: "competition-1",
    seasonId: "season-1",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "819", name: "Pérez Zeledón" },
    kickoffAt: "2026-10-20T02:00:00.000Z",
    status: "finished",
    ratingState,
    score: { home: 2, away: 1 },
    externalProvider: "api-football",
    externalProviderFixtureId: id,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-20T05:00:00.000Z",
  };
}

function result(matchValue: Match): MatchResult {
  return {
    matchId: matchValue.id,
    teamId: matchValue.trackedTeamId,
    ballotCount: 2,
    status: "final",
    playerResults: {
      player: {
        playerId: "player",
        playerName: "Jugador",
        average: 8,
        voteCount: 2,
        order: 0,
      },
    },
    coachResult: {
      coachId: "coach",
      coachName: "Director",
      average: 7,
      voteCount: 2,
    },
    mvpPlayerIds: ["player"],
    generatedAt: "2026-10-20T05:00:00.000Z",
  };
}

function snapshot(value: Match) {
  return { id: value.id, exists: true, data: () => value };
}

function resultSnapshot(matchValue: Match, value: MatchResult) {
  return {
    id: "summary",
    exists: true,
    data: () => value,
    ref: { parent: { parent: { id: matchValue.id } } },
  };
}
