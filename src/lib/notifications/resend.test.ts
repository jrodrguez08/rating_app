import { describe, expect, it, vi } from "vitest";

import type { VotingWindowNotificationMessage } from "@/application/voting-window-notification";

import {
  readNotificationSiteUrl,
  readResendNotificationConfig,
  ResendVotingWindowNotifier,
} from "./resend";

const message: VotingWindowNotificationMessage = {
  matchId: "match-1",
  windowSequence: 1,
  homeTeamName: "Home",
  awayTeamName: "Away",
  score: { home: 3, away: 2 },
  opensAt: "2026-10-13T02:00:00.000Z",
  closesAt: "2026-10-13T04:00:00.000Z",
  idempotencyKey: "voting-open/match-1/1",
  ratingUrl: "https://ratings.example/matches/match-1/rate",
};

describe("Resend voting-window notifier", () => {
  it("uses only an explicitly configured safe canonical origin", () => {
    expect(readNotificationSiteUrl({})).toBeUndefined();
    expect(
      readNotificationSiteUrl({ NEXT_PUBLIC_SITE_URL: "http://local.test" }),
    ).toBeUndefined();
    expect(
      readNotificationSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://ratings.example",
      })?.href,
    ).toBe("https://ratings.example/");
  });

  it("requires complete valid server configuration", () => {
    expect(readResendNotificationConfig({})).toBeNull();
    expect(
      readResendNotificationConfig({
        RESEND_API_KEY: "secret",
        VOTING_WINDOW_OPERATOR_EMAIL: "invalid",
        VOTING_WINDOW_FROM_EMAIL: "Rating App <alerts@example.com>",
      }),
    ).toBeNull();
    expect(
      readResendNotificationConfig({
        RESEND_API_KEY: "secret",
        VOTING_WINDOW_OPERATOR_EMAIL: "operator@example.com",
        VOTING_WINDOW_FROM_EMAIL: "Rating App <alerts@example.com>",
      }),
    ).toEqual({
      apiKey: "secret",
      operatorEmail: "operator@example.com",
      fromEmail: "Rating App <alerts@example.com>",
    });
  });

  it("sends a concise idempotent email without exposing credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const notifier = new ResendVotingWindowNotifier(
      {
        apiKey: "server-secret",
        operatorEmail: "operator@example.com",
        fromEmail: "Rating App <alerts@example.com>",
      },
      request,
      "en",
    );

    await expect(notifier.send(message)).resolves.toEqual({
      providerMessageId: "email-1",
    });
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer server-secret",
      "Idempotency-Key": message.idempotencyKey,
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      from: "Rating App <alerts@example.com>",
      to: ["operator@example.com"],
      subject: "Voting is open: Home vs Away",
      text: expect.stringContaining(
        "Vote: https://ratings.example/matches/match-1/rate",
      ),
    });
  });

  it("returns a generic error for provider failures", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("recipient rejected", { status: 400 }));
    const notifier = new ResendVotingWindowNotifier(
      {
        apiKey: "server-secret",
        operatorEmail: "operator@example.com",
        fromEmail: "alerts@example.com",
      },
      request,
    );

    await expect(notifier.send(message)).rejects.toThrow(
      "Notification delivery failed.",
    );
  });
});
