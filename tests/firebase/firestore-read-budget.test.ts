import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Query, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { selectPublicMatch } from "@/application/public-match-selection";
import { AdminConsoleService } from "@/lib/firebase/admin-console";
import { getPublicHomeMatch } from "@/lib/firebase/lifecycle-read";
import { AdminFootballSyncStore } from "@/lib/firebase/server";

import { measureReads } from "./read-counts";

const app = initializeApp(
  { projectId: "demo-rating-app-read-budget" },
  `read-budget-${Date.now()}`,
);
const database = getFirestore(app);
const now = new Date("2026-11-05T12:00:00.000Z");
const teamId = "read-budget-team";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Firestore emulator required.");
  for (let offset = 0; offset < 1000; offset += 400) {
    const batch = database.batch();
    for (let index = offset; index < Math.min(offset + 400, 1000); index++) {
      batch.set(
        database.doc(`matches/history-${index}`),
        matchData(
          new Date(Date.UTC(2020, 0, index + 1)),
          "finished",
          "rating_closed",
        ),
      );
    }
    await batch.commit();
  }
  await database
    .doc("matches/upcoming")
    .set(
      matchData(new Date(now.getTime() + 3600_000), "scheduled", "not_ready"),
    );
  const batch = database.batch();
  for (let index = 0; index < 21; index++) {
    const playerId = `player-${index}`;
    batch.set(database.doc(`players/${playerId}`), { displayName: playerId });
    batch.set(database.doc(`matches/upcoming/participants/${playerId}`), {
      matchId: "upcoming",
      teamId,
      playerId,
      playerName: playerId,
      starter: index < 11,
      participated: index < 11,
      squadRole: index < 11 ? "starter" : "substitute",
    });
  }
  await batch.commit();
});

afterAll(() => deleteApp(app));

function matchData(
  kickoff: Date,
  status: string,
  ratingState: string,
  trackedTeamId = teamId,
) {
  return {
    trackedTeamId,
    externalProviderFixtureId: "shared-fixture",
    homeTeam: { name: "Home" },
    awayTeam: { name: "Away" },
    status,
    ratingState,
    kickoffAt: Timestamp.fromDate(kickoff),
    createdAt: Timestamp.fromDate(kickoff),
    updatedAt: Timestamp.fromDate(kickoff),
  };
}

describe("Firestore read budgets", () => {
  it("measures the full-history Home baseline", async () => {
    const read = await measureReads(async () =>
      selectPublicMatch(
        await new AdminFootballSyncStore(database).listMatches(teamId),
        now,
      ),
    );
    expect(read.value?.id).toBe("upcoming");
    expect(read.documents).toBe(1001);
    expect(read.queries).toBe(1);
    const optimized = await measureReads(() =>
      getPublicHomeMatch(teamId, now, database, () => undefined),
    );
    expect(optimized.value).toEqual(read.value);
    expect(optimized.documents).toBe(3);
    expect(optimized.queries).toBe(3);
  });

  it("measures selected Match evidence reads", async () => {
    const read = await measureReads(() =>
      new AdminConsoleService(database).detail("upcoming", teamId, "owner"),
    );
    expect(read.value?.match.confirmedStarterCount).toBe(11);
    expect(read.documents).toBe(49);
    expect(read.queries).toBe(1);
    expect(
      read.paths.filter((path) => path.includes("/participants/")),
    ).toHaveLength(21);
    expect(
      read.paths.filter((path) => path.endsWith("/verifiedLineups/current")),
    ).toHaveLength(1);
  });

  it("keeps repeated Home reads independent of historical growth", async () => {
    for (let request = 0; request < 3; request++) {
      const read = await measureReads(() =>
        getPublicHomeMatch(teamId, now, database, () => undefined),
      );
      expect(read.value?.id).toBe("upcoming");
      expect(read.documents).toBe(3);
    }
  });

  it("uses six minimum query reads for an empty club and never loads identities", async () => {
    const read = await measureReads(() =>
      getPublicHomeMatch("empty-club", now, database, () => undefined),
    );
    expect(read.value).toBeNull();
    expect(read.documents).toBe(6);
    expect(read.queries).toBe(6);
    expect(read.paths).toEqual([]);
  });

  it("keeps two club views of a shared fixture separate", async () => {
    const batch = database.batch();
    for (const team of ["club-a", "club-b"]) {
      batch.set(
        database.doc(`matches/shared-${team}`),
        matchData(new Date(now.getTime() - 1000), "live", "not_ready", team),
      );
    }
    await batch.commit();
    for (const team of ["club-a", "club-b"]) {
      const read = await measureReads(() =>
        getPublicHomeMatch(team, now, database, () => undefined),
      );
      expect(read.value).toMatchObject({
        id: `shared-${team}`,
        trackedTeamId: team,
        externalProviderFixtureId: "shared-fixture",
      });
      expect(read.documents).toBe(2);
    }
  });

  it("continues past 100 expired or invalid windows to find an old reopened window", async () => {
    const team = "window-pages";
    const batch = database.batch();
    for (let index = 0; index < 125; index++) {
      batch.set(database.doc(`matches/window-${index}`), {
        ...matchData(
          new Date(Date.UTC(2026, 0, index + 1)),
          "finished",
          "rating_ready",
          team,
        ),
        votingOpensAt: Timestamp.fromMillis(now.getTime() - 7200_000),
        votingClosesAt: Timestamp.fromMillis(now.getTime() - 3600_000),
      });
    }
    batch.set(database.doc("matches/old-reopened"), {
      ...matchData(
        new Date("2020-01-01T00:00:00Z"),
        "finished",
        "rating_ready",
        team,
      ),
      votingReopenCount: 1,
      votingOpensAt: Timestamp.fromMillis(now.getTime() - 7200_000),
      votingClosesAt: Timestamp.fromMillis(now.getTime() - 3600_000),
      effectiveVotingOpensAt: Timestamp.fromMillis(now.getTime() - 1000),
      effectiveVotingClosesAt: Timestamp.fromMillis(now.getTime() + 1000),
    });
    await batch.commit();
    const logs: string[] = [];
    const read = await measureReads(() =>
      getPublicHomeMatch(team, now, database, (line) => logs.push(line)),
    );
    expect(read.value?.id).toBe("old-reopened");
    expect(read.documents).toBe(126);
    expect(read.queries).toBe(3);
    expect(JSON.parse(logs[0])).toMatchObject({
      event: "firestore.home_read",
      documentReads: 126,
      expensive: true,
    });
    const baseline = selectPublicMatch(
      await new AdminFootballSyncStore(database).listMatches(team),
      now,
    );
    expect(read.value).toEqual(baseline);
  });

  it("matches the canonical selector across live, future, expired, historical and tied fixtures", async () => {
    const cases = [
      [
        {
          id: "live-stale",
          hours: -5,
          status: "live",
          ratingState: "not_ready",
        },
        {
          id: "live-future",
          hours: 1,
          status: "live",
          ratingState: "not_ready",
        },
        {
          id: "scheduled-boundary",
          hours: -4,
          status: "scheduled",
          ratingState: "not_ready",
        },
      ],
      [
        {
          id: "live-boundary",
          hours: -4,
          status: "live",
          ratingState: "preparing_rating",
        },
        {
          id: "scheduled",
          hours: 1,
          status: "scheduled",
          ratingState: "not_ready",
        },
      ],
      [
        {
          id: "finished",
          hours: -24,
          status: "finished",
          ratingState: "not_ready",
        },
        {
          id: "closed",
          hours: -12,
          status: "cancelled",
          ratingState: "rating_closed",
        },
        {
          id: "manual",
          hours: -6,
          status: "live",
          ratingState: "rating_ready",
          votingOpeningMode: "manual",
        },
      ],
      [
        {
          id: "tie-a",
          hours: -6,
          status: "finished",
          ratingState: "rating_closed",
        },
        {
          id: "tie-z",
          hours: -6,
          status: "cancelled",
          ratingState: "rating_closed",
        },
      ],
    ];
    for (const [index, matches] of cases.entries()) {
      const team = `selector-parity-${index}`;
      for (const match of matches) {
        await database.doc(`matches/${match.id}`).set({
          ...matchData(
            new Date(now.getTime() + match.hours * 3600_000),
            match.status,
            match.ratingState,
            team,
          ),
          ...("votingOpeningMode" in match
            ? { votingOpeningMode: match.votingOpeningMode }
            : {}),
        });
      }
      const expected = selectPublicMatch(
        await new AdminFootballSyncStore(database).listMatches(team),
        now,
      );
      const actual = await getPublicHomeMatch(
        team,
        now,
        database,
        () => undefined,
      );
      expect(actual).toEqual(expected ?? null);
    }
  });

  it("fails without retrying a quota error and emits only safe read metadata", async () => {
    const error = Object.assign(new Error("Quota exceeded"), { code: 8 });
    const query = vi.spyOn(Query.prototype, "get").mockRejectedValueOnce(error);
    const logs: string[] = [];
    try {
      await expect(
        getPublicHomeMatch(teamId, now, database, (line) => logs.push(line)),
      ).rejects.toBe(error);
      expect(query).toHaveBeenCalledTimes(1);
      expect(JSON.parse(logs[0])).toEqual({
        event: "firestore.home_read",
        teamId,
        queries: 1,
        documentReads: 0,
        status: "failed",
        expensive: false,
      });
    } finally {
      query.mockRestore();
    }
  });
});
