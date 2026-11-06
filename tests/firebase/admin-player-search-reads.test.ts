import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { playerProviderAliasId } from "@/domain/player-identity";
import {
  normalizePlayerSearch,
  playerSearchPrefixes,
} from "@/domain/player-search";
import { AdminConsoleService } from "@/lib/firebase/admin-console";

import { measureReads } from "./read-counts";

const app = initializeApp(
  { projectId: "demo-rating-player-search-reads" },
  `player-search-reads-${Date.now()}`,
);
const database = getFirestore(app);
const service = new AdminConsoleService(database);
const teams = ["search-team-a", "search-team-b"];

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Firestore emulator required.");
  const stamp = Timestamp.now();
  for (const team of teams) {
    const batch = database.batch();
    batch.set(database.doc(`teams/${team}/playerMembershipIndex/state`), {
      teamId: team,
      status: "complete",
      schemaVersion: 1,
      blockingIssueCount: 0,
    });
    for (let index = 0; index < 125; index++) {
      const id = `${team}-${String(index).padStart(3, "0")}`;
      const name = `${index < 100 ? "Aguilar" : "Juarez"} ${String(index).padStart(3, "0")}`;
      batch.set(database.doc(`players/${id}`), {
        displayName: name,
        externalProvider: "api-football",
        externalProviderId: `${team}-${index}`,
        createdAt: stamp,
        updatedAt: stamp,
      });
      batch.set(database.doc(`teams/${team}/playerMemberships/${id}`), {
        playerId: id,
        teamId: team,
        displayName: name,
        searchName: normalizePlayerSearch(name),
        searchPrefixes: playerSearchPrefixes(name),
        source: "fixture_catalog",
        sourceFixtureIds: ["synthetic-fixture"],
        firstObservedAt: stamp,
        lastObservedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      });
    }
    await batch.commit();
  }
  for (let offset = 0; offset < 1000; offset += 400) {
    const batch = database.batch();
    for (let index = offset; index < Math.min(1000, offset + 400); index++)
      batch.set(database.doc(`players/unrelated-search-${index}`), {
        displayName: "Unrelated",
      });
    await batch.commit();
  }
});
afterAll(() => deleteApp(app));

describe("real administrative Player search read budgets", () => {
  it.each(["", "a", "ag", "agui", "aguil", "aguilar", "jua", "juare"])(
    "bounds query '%s' to one membership page",
    async (query) => {
      const read = await measureReads(() =>
        service.searchPlayers(teams[0], query),
      );
      expect(read.value.players).toHaveLength(20);
      expect(read.documents).toBe(62);
      expect(read.queries).toBe(1);
      expect(
        read.paths.filter((path) => path.includes("/playerMemberships/")),
      ).toHaveLength(21);
      expect(read.paths.some((path) => path.includes("unrelated-search"))).toBe(
        false,
      );
    },
  );

  it("distinguishes an exact result, no matches and repeated uncached requests", async () => {
    const exact = await measureReads(() =>
      service.searchPlayers(teams[0], "aguilar 000"),
    );
    expect(exact.value.players).toHaveLength(1);
    expect(exact.documents).toBe(4);
    const empty = await measureReads(() =>
      service.searchPlayers(teams[0], "no matches"),
    );
    expect(empty.value.players).toEqual([]);
    expect(empty.documents).toBe(2);
    for (let repeat = 0; repeat < 3; repeat++) {
      const read = await measureReads(() =>
        service.searchPlayers(teams[0], "aguil"),
      );
      expect(read.documents).toBe(62);
    }
  });

  it("continues every club page past 100 candidates without mixing identities", async () => {
    for (const team of teams) {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const read = await measureReads(() =>
          service.searchPlayers(team, "", cursor),
        );
        expect(read.documents).toBeLessThanOrEqual(62);
        expect(read.queries).toBe(1);
        expect(
          read.value.players.every((player) => player.id.startsWith(team)),
        ).toBe(true);
        ids.push(...read.value.players.map((player) => player.id));
        cursor = read.value.nextCursor;
      } while (cursor);
      expect(new Set(ids).size).toBe(125);
    }
  });

  it("includes focused alias resolution in the cost without adding queries", async () => {
    const observedId = `${teams[0]}-000`;
    const canonicalId = "search-canonical";
    await database
      .doc(`players/${canonicalId}`)
      .set({ displayName: "Canonical Aguilar" });
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", `${teams[0]}-0`)}`,
      )
      .set({ canonicalPlayerId: canonicalId });
    const read = await measureReads(() =>
      service.searchPlayers(teams[0], "aguilar 000"),
    );
    expect(read.value.players[0].id).toBe(canonicalId);
    expect(read.documents).toBe(5);
    expect(read.queries).toBe(1);
    expect(read.paths).toContain(`players/${observedId}`);
    expect(read.paths).toContain(`players/${canonicalId}`);
  });
});
