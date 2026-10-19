import { describe, expect, it } from "vitest";

import {
  proposedCoachProviderAlias,
  resolvePersistedCoachProviderAlias,
} from "./coach-identity";

describe("Coach provider identity", () => {
  it("retains a reviewed alias during later default provider sync", () => {
    const reviewed = proposedCoachProviderAlias(
      "api-football",
      "42",
      "2026-01-01T00:00:00.000Z",
      "coach-manual",
    );
    const incoming = proposedCoachProviderAlias(
      "api-football",
      "42",
      "2026-02-01T00:00:00.000Z",
    );
    expect(resolvePersistedCoachProviderAlias(reviewed, incoming)).toBe(
      reviewed,
    );
  });

  it("allows one reviewed transition from the provider self alias", () => {
    const existing = proposedCoachProviderAlias(
      "api-football",
      "42",
      "2026-01-01T00:00:00.000Z",
    );
    const proposed = proposedCoachProviderAlias(
      "api-football",
      "42",
      "2026-02-01T00:00:00.000Z",
      "coach-manual",
    );
    expect(resolvePersistedCoachProviderAlias(existing, proposed)).toEqual({
      ...proposed,
      createdAt: existing.createdAt,
    });
  });

  it("rejects replacing an established reviewed canonical Coach", () => {
    const existing = proposedCoachProviderAlias(
      "api-football",
      "42",
      "2026-01-01T00:00:00.000Z",
      "coach-first",
    );
    const proposed = proposedCoachProviderAlias(
      "api-football",
      "42",
      "2026-02-01T00:00:00.000Z",
      "coach-second",
    );
    expect(() =>
      resolvePersistedCoachProviderAlias(existing, proposed),
    ).toThrow("already has a canonical identity");
  });
});
