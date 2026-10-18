import { describe, expect, it } from "vitest";

import {
  parseCoachAssignmentArguments,
  requireCoachOperatorId,
} from "./manage-coach-assignment";

const base = [
  "--project-id",
  "rating-app-prod",
  "--match-id",
  "match-1",
  "--fixture-id",
  "1551697",
  "--coach-id",
  "coach-verified-1",
  "--coach-name",
  "Verified Coach",
  "--source",
  "https://example.com/match-report",
  "--reason",
  "Independent fixture report identifies the head coach.",
];

describe("verified coach assignment CLI", () => {
  it("defaults to a dry run and accepts an optional real provider identity", () => {
    expect(parseCoachAssignmentArguments(base)).toMatchObject({
      matchId: "match-1",
      fixtureId: "1551697",
      coachId: "coach-verified-1",
      apply: false,
    });
    expect(
      parseCoachAssignmentArguments([...base, "--provider-coach-id", "29352"])
        .providerCoachId,
    ).toBe("29352");
  });

  it("requires exact match confirmation for apply", () => {
    expect(
      parseCoachAssignmentArguments([
        ...base,
        "--apply",
        "true",
        "--confirm",
        "assign-verified-coach:match-1",
      ]).apply,
    ).toBe(true);
    expect(() =>
      parseCoachAssignmentArguments([
        ...base,
        "--apply",
        "true",
        "--confirm",
        "assign-verified-coach:other",
      ]),
    ).toThrow(/usage/i);
  });

  it("rejects missing or malformed evidence", () => {
    expect(() =>
      parseCoachAssignmentArguments(
        base.map((value) =>
          value === "https://example.com/match-report"
            ? "http://example.com"
            : value,
        ),
      ),
    ).toThrow(/usage/i);
    expect(() => parseCoachAssignmentArguments(base.slice(0, -2))).toThrow(
      /usage/i,
    );
  });

  it("requires a stable sanitized operator identity", () => {
    expect(() => requireCoachOperatorId({})).toThrow(/not configured/i);
    expect(
      requireCoachOperatorId({
        VOTING_WINDOW_OPERATOR_ID: "owner@example.com",
      }),
    ).toBe("owner@example.com");
  });
});
