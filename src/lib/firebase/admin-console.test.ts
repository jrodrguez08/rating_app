import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { initialClub } from "@/config/club";

import { AdminConsoleService } from "./admin-console";

describe("AdminConsoleService overview queries", () => {
  it("uses bounded nearest-first preparation and authoritative-state queries", async () => {
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn(async () => ({ docs: [] })),
    };
    const database = {
      collection: vi.fn(() => query),
    } as unknown as Firestore;
    const now = new Date("2026-11-01T02:05:00.000Z");

    await new AdminConsoleService(database, undefined, () => now).overview();

    expect(database.collection).toHaveBeenCalledOnce();
    expect(database.collection).toHaveBeenCalledWith("matches");
    expect(query.where).toHaveBeenNthCalledWith(
      1,
      "trackedTeamId",
      "==",
      initialClub.teamId,
    );
    expect(query.where).toHaveBeenNthCalledWith(2, "status", "==", "live");
    expect(query.where).toHaveBeenNthCalledWith(3, "ratingState", "in", [
      "not_ready",
      "preparing_rating",
    ]);
    expect(query.where).toHaveBeenNthCalledWith(
      4,
      "kickoffAt",
      ">=",
      Timestamp.fromDate(new Date("2026-10-31T22:05:00.000Z")),
    );
    expect(query.where).toHaveBeenNthCalledWith(6, "status", "==", "scheduled");
    expect(query.where).toHaveBeenNthCalledWith(
      10,
      "ratingState",
      "==",
      "rating_ready",
    );
    expect(query.where).toHaveBeenNthCalledWith(
      12,
      "ratingState",
      "==",
      "rating_closed",
    );
    expect(query.where).toHaveBeenNthCalledWith(14, "status", "==", "finished");
    expect(query.where).toHaveBeenNthCalledWith(
      15,
      "ratingState",
      "==",
      "preparing_rating",
    );
    expect(query.orderBy).toHaveBeenNthCalledWith(1, "kickoffAt", "asc");
    expect(query.orderBy).toHaveBeenNthCalledWith(2, "kickoffAt", "asc");
    expect(query.orderBy).toHaveBeenNthCalledWith(3, "kickoffAt", "desc");
    expect(query.orderBy).toHaveBeenNthCalledWith(4, "kickoffAt", "desc");
    expect(query.orderBy).toHaveBeenNthCalledWith(5, "kickoffAt", "desc");
    expect(query.limit.mock.calls).toEqual([[10], [10], [10], [10], [10]]);
    expect(query.get).toHaveBeenCalledTimes(5);
  });
});
