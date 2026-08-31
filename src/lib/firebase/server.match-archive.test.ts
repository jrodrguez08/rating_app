import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import type { Match } from "@/domain/models";

import { AdminMatchArchiveService } from "./server";

describe("AdminMatchArchiveService", () => {
  it("builds archive and detail DTOs only from persisted Firestore facts", async () => {
    const match = matchValue();
    const operations: string[] = [];
    const matchSnapshot = snapshot(match.id, match);
    const competitionSnapshot = snapshot("competition", {
      name: "Primera Division",
    });
    const resultSnapshot = missingSnapshot(
      `matches/${match.id}/results/summary`,
    );
    const query = {
      where: vi.fn(() => query),
      get: vi.fn(async () => {
        operations.push("query:matches");
        return { docs: [matchSnapshot] };
      }),
    };
    const database = {
      collection: vi.fn(() => query),
      doc: vi.fn((path: string) => ({
        path,
        get: vi.fn(async () => {
          operations.push(`get:${path}`);
          if (path === `matches/${match.id}`) return matchSnapshot;
          if (path === "competitions/competition") return competitionSnapshot;
          return resultSnapshot;
        }),
      })),
      getAll: vi.fn(async (...references: Array<{ path: string }>) => {
        operations.push(
          `getAll:${references.map(({ path }) => path).join(",")}`,
        );
        return references.map(({ path }) =>
          path.startsWith("competitions/")
            ? competitionSnapshot
            : resultSnapshot,
        );
      }),
    } as unknown as Firestore;
    const service = new AdminMatchArchiveService(database);

    const archive = await service.list(
      "team",
      new Date("2026-08-31T12:00:00Z"),
    );
    const detail = await service.get(match.id, "team");

    expect(archive.relevant?.match.id).toBe(match.id);
    expect(detail).toMatchObject({
      match: { id: match.id },
      competitionName: "Primera Division",
      hasResults: false,
    });
    expect(JSON.stringify({ archive, detail })).not.toMatch(/voterId|ballot/i);
    expect(operations).toEqual(
      expect.arrayContaining([
        "query:matches",
        "getAll:competitions/competition",
        `getAll:matches/${match.id}/results/summary`,
        `get:matches/${match.id}`,
        "get:competitions/competition",
        `get:matches/${match.id}/results/summary`,
      ]),
    );
  });

  it("uses the Firestore document ID when a legacy payload contains a different ID", async () => {
    const match = matchValue();
    const documentId = "durable-match-document";
    const legacyPayloadId = "legacy-payload-id";
    const matchSnapshot = snapshot(documentId, {
      ...match,
      id: legacyPayloadId,
    });
    const upcomingSnapshot = snapshot("upcoming-document", {
      ...match,
      id: "legacy-upcoming-id",
      kickoffAt: "2026-09-02T18:00:00.000Z",
      externalProviderFixtureId: "2",
    });
    const recentSnapshot = snapshot("recent-document", {
      ...match,
      id: "legacy-recent-id",
      kickoffAt: "2026-08-30T18:00:00.000Z",
      status: "finished",
      externalProviderFixtureId: "3",
    });
    const competitionSnapshot = snapshot("competition", {
      name: "Primera Division",
    });
    const query = {
      where: vi.fn(() => query),
      get: vi.fn(async () => ({
        docs: [matchSnapshot, upcomingSnapshot, recentSnapshot],
      })),
    };
    const database = {
      collection: vi.fn(() => query),
      doc: vi.fn((path: string) => ({
        path,
        get: vi.fn(async () => {
          if (path === `matches/${documentId}`) return matchSnapshot;
          if (path === "competitions/competition") return competitionSnapshot;
          return missingSnapshot(path);
        }),
      })),
      getAll: vi.fn(async (...references: Array<{ path: string }>) =>
        references.map(({ path }) =>
          path.startsWith("competitions/")
            ? competitionSnapshot
            : missingSnapshot(path),
        ),
      ),
    } as unknown as Firestore;
    const service = new AdminMatchArchiveService(database);

    const archive = await service.list(
      "team",
      new Date("2026-08-31T12:00:00Z"),
    );

    expect(archive.relevant?.match.id).toBe(documentId);
    expect(archive.upcoming.map(({ match: value }) => value.id)).toEqual([
      "upcoming-document",
    ]);
    expect(archive.recent.map(({ match: value }) => value.id)).toEqual([
      "recent-document",
    ]);
    await expect(service.get(documentId, "team")).resolves.toMatchObject({
      match: { id: documentId },
    });
    await expect(service.get(legacyPayloadId, "team")).resolves.toBeNull();
    await expect(service.get(documentId, "other-team")).resolves.toBeNull();
  });
});

function snapshot(id: string, value: object) {
  return {
    id,
    exists: true,
    data: () => value,
    ref: { parent: { parent: { id } } },
  };
}

function missingSnapshot(path: string) {
  const matchId = path.split("/")[1];
  return {
    id: "summary",
    exists: false,
    data: () => undefined,
    ref: { parent: { parent: { id: matchId } } },
  };
}

function matchValue(): Match {
  return {
    id: "match-1",
    trackedTeamId: "team",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Herediano" },
    awayTeam: { externalProviderId: "820", name: "Cartagines" },
    kickoffAt: "2026-09-01T18:00:00.000Z",
    status: "scheduled",
    ratingState: "not_ready",
    score: { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: "1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}
