import { describe, expect, it } from "vitest";

import { parsePlayerIdentityReconciliationArguments } from "./reconcile-player-identities";

describe("player identity reconciliation CLI", () => {
  it("defaults to a read-only dry run", () => {
    expect(
      parsePlayerIdentityReconciliationArguments([
        "--project-id",
        "rating-app-prod",
      ]),
    ).toEqual({ projectId: "rating-app-prod", apply: false });
  });

  it("requires the exact apply flag and confirmation phrase for writes", () => {
    expect(
      parsePlayerIdentityReconciliationArguments([
        "--project-id",
        "rating-app-prod",
        "--apply",
        "true",
        "--confirm",
        "reconcile-player-identities",
      ]),
    ).toEqual({ projectId: "rating-app-prod", apply: true });
    expect(() =>
      parsePlayerIdentityReconciliationArguments([
        "--project-id",
        "rating-app-prod",
        "--apply",
        "true",
        "--confirm",
        "wrong",
      ]),
    ).toThrow(/usage/i);
  });
});
