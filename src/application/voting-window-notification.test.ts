import { describe, expect, it, vi } from "vitest";

import type {
  VotingWindowNotificationClaim,
  VotingWindowNotificationStore,
} from "@/domain/ports";

import {
  notificationIdempotencyKey,
  notifyVotingWindowOpenedIfPending,
} from "./voting-window-notification";

const context = {
  matchId: "match-1",
  windowSequence: 0,
  homeTeamName: "Home",
  awayTeamName: "Away",
  score: { home: 2, away: 1 },
  opensAt: "2026-10-13T02:00:00.000Z",
  closesAt: "2026-10-13T04:00:00.000Z",
};

class MemoryNotificationStore implements VotingWindowNotificationStore {
  status: "pending" | "sending" | "sent" = "pending";
  attemptId?: string;
  firstAttemptSet = false;

  async claimVotingWindowNotification(
    _matchId: string,
    attemptId: string,
  ): Promise<VotingWindowNotificationClaim> {
    if (this.status === "sent") {
      return { status: "already_sent", windowSequence: 0 };
    }
    if (this.status === "sending") {
      return { status: "in_flight", windowSequence: 0 };
    }
    this.status = "sending";
    this.attemptId = attemptId;
    this.firstAttemptSet = true;
    return { status: "claimed", context };
  }

  async markVotingWindowNotificationSent(
    _matchId: string,
    _windowSequence: number,
    attemptId: string,
  ) {
    if (this.attemptId !== attemptId) return false;
    this.status = "sent";
    this.attemptId = undefined;
    return true;
  }

  async releaseVotingWindowNotification(
    _matchId: string,
    _windowSequence: number,
    attemptId: string,
    resetFirstAttempt: boolean,
  ) {
    if (this.attemptId !== attemptId) return;
    this.status = "pending";
    this.attemptId = undefined;
    if (resetFirstAttempt) this.firstAttemptSet = false;
  }
}

describe("voting-window operator notification", () => {
  it("sends once per window with a stable idempotency key and safe context", async () => {
    const store = new MemoryNotificationStore();
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-1" });

    const first = await notifyVotingWindowOpenedIfPending({
      matchId: context.matchId,
      store,
      notifier: { send },
      siteUrl: new URL("https://ratings.example"),
      attemptId: "attempt-1",
    });
    const second = await notifyVotingWindowOpenedIfPending({
      matchId: context.matchId,
      store,
      notifier: { send },
      attemptId: "attempt-2",
    });

    expect(first).toBe("sent");
    expect(second).toBe("already_sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      ...context,
      idempotencyKey: "voting-open/match-1/0",
      ratingUrl: "https://ratings.example/matches/match-1/rate",
    });
  });

  it("releases failed delivery for a safe retry with the same provider key", async () => {
    const store = new MemoryNotificationStore();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce({ providerMessageId: "email-2" });

    expect(
      await notifyVotingWindowOpenedIfPending({
        matchId: context.matchId,
        store,
        notifier: { send },
        attemptId: "attempt-1",
      }),
    ).toBe("failed");
    expect(
      await notifyVotingWindowOpenedIfPending({
        matchId: context.matchId,
        store,
        notifier: { send },
        attemptId: "attempt-2",
      }),
    ).toBe("sent");
    expect(send.mock.calls.map(([message]) => message.idempotencyKey)).toEqual([
      notificationIdempotencyKey(context.matchId, 0),
      notificationIdempotencyKey(context.matchId, 0),
    ]);
  });

  it("does not consume the notification when provider configuration is absent", async () => {
    const store = new MemoryNotificationStore();

    expect(
      await notifyVotingWindowOpenedIfPending({
        matchId: context.matchId,
        store,
        notifier: null,
        attemptId: "attempt-1",
      }),
    ).toBe("not_configured");
    expect(store.status).toBe("pending");
    expect(store.firstAttemptSet).toBe(false);
  });

  it("returns a failure outcome when notification persistence is unavailable", async () => {
    const logs: string[] = [];
    const store = {
      claimVotingWindowNotification: vi
        .fn()
        .mockRejectedValue(new Error("firestore unavailable")),
      markVotingWindowNotificationSent: vi.fn(),
      releaseVotingWindowNotification: vi.fn(),
    } satisfies VotingWindowNotificationStore;

    await expect(
      notifyVotingWindowOpenedIfPending({
        matchId: context.matchId,
        store,
        notifier: null,
        log: (message) => logs.push(message),
      }),
    ).resolves.toBe("failed");
    expect(logs.join("\n")).toContain('"event":"voting.notification"');
    expect(logs.join("\n")).toContain('"reason":"claim-failed"');
  });
});
