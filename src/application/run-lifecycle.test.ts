import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MatchLifecycleStore,
  VotingWindowNotificationStore,
} from "@/domain/ports";

const mocks = vi.hoisted(() => ({ runMatchLifecycle: vi.fn() }));

vi.mock("@/application/match-lifecycle", () => ({
  runMatchLifecycle: mocks.runMatchLifecycle,
}));

import { runConfiguredLifecycle } from "./run-lifecycle";

describe("configured match lifecycle notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("notifies once after rating_ready and suppresses the repeated lifecycle pass", async () => {
    mocks.runMatchLifecycle
      .mockResolvedValueOnce({
        action: "rating_ready",
        matchId: "match-1",
        providerRequests: 4,
      })
      .mockResolvedValueOnce({
        action: "idle",
        matchId: "match-1",
        providerRequests: 0,
      });
    let sent = false;
    const notificationStore = {
      claimVotingWindowNotification: vi.fn(async () =>
        sent
          ? ({ status: "already_sent", windowSequence: 0 } as const)
          : ({
              status: "claimed",
              context: {
                matchId: "match-1",
                windowSequence: 0,
                homeTeamName: "Home",
                awayTeamName: "Away",
                score: { home: 2, away: 1 },
                opensAt: "2026-10-13T02:00:00.000Z",
                closesAt: "2026-10-13T04:00:00.000Z",
              },
            } as const),
      ),
      markVotingWindowNotificationSent: vi.fn(async () => {
        sent = true;
        return true;
      }),
      releaseVotingWindowNotification: vi.fn(),
    } satisfies VotingWindowNotificationStore;
    const send = vi.fn().mockResolvedValue({ providerMessageId: "email-1" });
    const lifecycleStore = {} as MatchLifecycleStore;

    const first = await runConfiguredLifecycle(
      "tracked-team",
      lifecycleStore,
      "provider-key",
      () => new Date("2026-10-13T02:00:00.000Z"),
      { store: notificationStore, notifier: { send } },
    );
    const second = await runConfiguredLifecycle(
      "tracked-team",
      lifecycleStore,
      "provider-key",
      () => new Date("2026-10-13T02:01:00.000Z"),
      { store: notificationStore, notifier: { send } },
    );

    expect(first).toMatchObject({
      action: "rating_ready",
      notification: "sent",
      providerRequests: 4,
    });
    expect(second).toMatchObject({
      action: "idle",
      notification: "already_sent",
      providerRequests: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      notificationStore.claimVotingWindowNotification,
    ).toHaveBeenCalledTimes(2);
  });

  it("skips provider work while another lifecycle execution owns the lease", async () => {
    const store = {
      claimLifecycleExecution: vi.fn().mockResolvedValue({
        status: "busy",
        attemptId: "active-attempt",
        leaseUntil: "2026-10-13T02:05:00.000Z",
      }),
      completeLifecycleExecution: vi.fn(),
    } as unknown as MatchLifecycleStore;

    const result = await runConfiguredLifecycle(
      "tracked-team",
      store,
      "provider-key",
      () => new Date("2026-10-13T02:00:00.000Z"),
      undefined,
      { trigger: "operator" },
    );

    expect(result).toMatchObject({
      action: "idle",
      executionStatus: "skipped_busy",
      providerRequests: 0,
      reason: expect.stringContaining("already in progress"),
    });
    expect(mocks.runMatchLifecycle).not.toHaveBeenCalled();
    expect(store.completeLifecycleExecution).not.toHaveBeenCalled();
  });

  it("records completion metrics for the claimed execution", async () => {
    mocks.runMatchLifecycle.mockResolvedValue({
      action: "refreshed",
      matchId: "match-1",
      providerRequests: 1,
    });
    const store = {
      claimLifecycleExecution: vi.fn().mockResolvedValue({
        status: "claimed",
        leaseUntil: "2026-10-13T02:05:00.000Z",
      }),
      completeLifecycleExecution: vi.fn().mockResolvedValue(undefined),
    } as unknown as MatchLifecycleStore;

    await runConfiguredLifecycle(
      "tracked-team",
      store,
      "provider-key",
      undefined,
      undefined,
      { trigger: "scheduled" },
    );

    expect(store.claimLifecycleExecution).toHaveBeenCalledWith(
      "tracked-team",
      expect.any(String),
      "scheduled",
    );
    expect(store.completeLifecycleExecution).toHaveBeenCalledWith(
      "tracked-team",
      expect.any(String),
      {
        action: "refreshed",
        matchId: "match-1",
        providerRequests: 1,
      },
    );
  });
});
