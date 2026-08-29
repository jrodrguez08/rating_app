import { describe, expect, it } from "vitest";

import { parseProductionBootstrapArguments } from "./bootstrap-production-team";

describe("production Team bootstrap guardrails", () => {
  it("requires explicit matching arguments and confirmation", () => {
    expect(
      parseProductionBootstrapArguments([
        "--project-id",
        "rating-app-production",
        "--provider-team-id",
        "815",
        "--confirm",
        "bootstrap-production-team",
      ]),
    ).toEqual({
      projectId: "rating-app-production",
      providerTeamId: "815",
    });
  });

  it("rejects missing confirmation, invalid provider identity, and demo projects", () => {
    expect(() =>
      parseProductionBootstrapArguments([
        "--project-id",
        "rating-app-production",
        "--provider-team-id",
        "815",
      ]),
    ).toThrow("Usage");
    expect(() =>
      parseProductionBootstrapArguments([
        "--project-id",
        "rating-app-production",
        "--provider-team-id",
        "not-numeric",
        "--confirm",
        "bootstrap-production-team",
      ]),
    ).toThrow("Usage");
    expect(() =>
      parseProductionBootstrapArguments([
        "--project-id",
        "demo-rating-app-local",
        "--provider-team-id",
        "815",
        "--confirm",
        "bootstrap-production-team",
      ]),
    ).toThrow("demo-*");
  });
});
