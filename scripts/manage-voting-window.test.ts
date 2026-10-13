import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseVotingWindowArguments,
  requireVotingWindowOperator,
} from "./manage-voting-window";

describe("operator voting-window CLI", () => {
  it("defaults both operations to dry-run and requires an explicit reopen close time", () => {
    expect(
      parseVotingWindowArguments([
        "reopen",
        "--project-id",
        "rating-app-prod",
        "--match-id",
        "match-1",
        "--close-at",
        "2026-10-13T20:00:00.000Z",
      ]),
    ).toMatchObject({ operation: "reopen", apply: false, matchId: "match-1" });
    expect(
      parseVotingWindowArguments([
        "close",
        "--project-id",
        "rating-app-prod",
        "--match-id",
        "match-1",
      ]),
    ).toEqual({
      operation: "close",
      projectId: "rating-app-prod",
      matchId: "match-1",
      apply: false,
    });
  });

  it("requires operation-specific exact confirmation for apply", () => {
    expect(
      parseVotingWindowArguments([
        "close",
        "--project-id",
        "rating-app-prod",
        "--match-id",
        "match-1",
        "--apply",
        "true",
        "--confirm",
        "close-voting-window:match-1",
      ]),
    ).toMatchObject({ operation: "close", apply: true });
    expect(() =>
      parseVotingWindowArguments([
        "close",
        "--project-id",
        "rating-app-prod",
        "--match-id",
        "match-1",
        "--apply",
        "true",
        "--confirm",
        "close-voting-window:other",
      ]),
    ).toThrow(/usage/i);
  });

  it("fails closed for missing or wrong operator credentials", () => {
    expect(() => requireVotingWindowOperator({})).toThrow(
      "Operator authorization failed.",
    );
    expect(() =>
      requireVotingWindowOperator({
        VOTING_WINDOW_OPERATOR_SECRET_SHA256: createHash("sha256")
          .update("correct")
          .digest("hex"),
        VOTING_WINDOW_OPERATOR_TOKEN: "wrong",
      }),
    ).toThrow("Operator authorization failed.");
  });

  it("accepts only the configured operator token without returning it", () => {
    const token = "high-entropy-operator-secret";
    expect(
      requireVotingWindowOperator({
        VOTING_WINDOW_OPERATOR_SECRET_SHA256: createHash("sha256")
          .update(token)
          .digest("hex"),
        VOTING_WINDOW_OPERATOR_TOKEN: token,
      }),
    ).toBeUndefined();
  });
});
