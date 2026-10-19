import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

import { playerSearchPrefixes } from "@/domain/player-search";

import {
  searchIndexedTeamPlayers,
  TeamPlayerMembershipIndexIncompleteError,
} from "./team-player-membership-index";

describe("online Team Player membership search", () => {
  it("rejects an unknown completeness state before querying memberships", async () => {
    const database = {
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(snapshot("state", undefined)),
      })),
      collection: vi.fn(),
    };

    await expect(
      searchIndexedTeamPlayers(
        database as unknown as Firestore,
        "team-unknown",
        "",
      ),
    ).rejects.toBeInstanceOf(TeamPlayerMembershipIndexIncompleteError);
    expect(database.collection).not.toHaveBeenCalled();
  });

  it("uses one bounded membership page and bounded identity lookups", async () => {
    const now = "2026-10-01T00:00:00.000Z";
    const membership = snapshot("player-1", {
      teamId: "team-1",
      displayName: "Álvaro Histórico",
      searchName: "alvaro historico",
      searchPrefixes: playerSearchPrefixes("Álvaro Histórico"),
      source: "match_participant",
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const query = {
      orderBy: vi.fn(),
      where: vi.fn(),
      startAfter: vi.fn(),
      limit: vi.fn(),
      get: vi.fn().mockResolvedValue({ size: 1, docs: [membership] }),
    };
    query.orderBy.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.startAfter.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const database = {
      collection: vi.fn().mockReturnValue(query),
      doc: vi.fn((path: string) => ({ path })),
      getAll: vi
        .fn()
        .mockImplementation(async (...references: { path: string }[]) =>
          references.map((reference) =>
            reference.path === "players/player-1"
              ? snapshot("player-1", {
                  displayName: "Álvaro Histórico",
                  identityProvenance: "provider",
                  createdAt: now,
                  updatedAt: now,
                })
              : snapshot(reference.path, undefined),
          ),
        ),
    };
    database.doc.mockImplementation((path: string) => ({
      path,
      get: vi.fn().mockResolvedValue(
        snapshot("state", {
          teamId: "team-1",
          status: "complete",
          schemaVersion: 1,
          baselineMembershipCount: 1,
          blockingIssueCount: 0,
          auditedAt: now,
        }),
      ),
    }));

    const reads: Array<{ kind: string; documents: number }> = [];
    const result = await searchIndexedTeamPlayers(
      database as unknown as Firestore,
      "team-1",
      "alvaro",
      undefined,
      (read) => reads.push(read),
    );

    expect(query.limit).toHaveBeenCalledWith(21);
    expect(query.get).toHaveBeenCalledTimes(1);
    expect(database.collection).toHaveBeenCalledTimes(1);
    expect(database.collection).toHaveBeenCalledWith(
      "teams/team-1/playerMemberships",
    );
    expect(result.players).toEqual([
      expect.objectContaining({
        player: expect.objectContaining({ id: "player-1" }),
      }),
    ]);
    expect(reads).toEqual([
      { kind: "index_state", documents: 1 },
      { kind: "membership_query", documents: 1 },
      { kind: "player_lookup", documents: 1 },
    ]);
  });
});

function snapshot(id: string, value: Record<string, unknown> | undefined) {
  return {
    id,
    exists: value !== undefined,
    data: () => value,
  };
}
