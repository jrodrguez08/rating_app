import { describe, expect, it } from "vitest";

import { parseSaprissaBootstrapArguments } from "./bootstrap-saprissa-team";

const base = [
  "--project-id",
  "rating-app-production",
  "--provider-team-id",
  "816",
];

describe("Saprissa production bootstrap arguments", () => {
  it("plans without apply and requires exact project-bound confirmation for writes", () => {
    expect(parseSaprissaBootstrapArguments(base)).toEqual({
      projectId: "rating-app-production",
      providerTeamId: "816",
      apply: false,
    });
    expect(
      parseSaprissaBootstrapArguments([
        ...base,
        "--apply",
        "true",
        "--confirm",
        "bootstrap-saprissa-team:rating-app-production",
      ]),
    ).toMatchObject({ apply: true });
  });

  it("rejects demo projects, malformed IDs, duplicate options, and inexact approval", () => {
    for (const args of [
      ["--project-id", "demo-local", "--provider-team-id", "816"],
      ["--project-id", "rating-app-production", "--provider-team-id", "0"],
      [...base, "--provider-team-id", "815"],
      [...base, "--apply", "true"],
      [
        ...base,
        "--apply",
        "true",
        "--confirm",
        "bootstrap-saprissa-team:other",
      ],
    ]) {
      expect(() => parseSaprissaBootstrapArguments(args)).toThrow("Usage");
    }
  });
});
