import { describe, expect, it } from "vitest";

import {
  proposedCoachProviderAlias,
  resolveCoachAssignmentIdentity,
  resolvePersistedCoachProviderAlias,
} from "./coach-identity";
import type { Coach } from "./models";
import { providerEntityId } from "./player-identity";

describe("read-only Coach assignment identity policy", () => {
  const provider = "api-football";
  const timestamp = "2026-01-01T00:00:00.000Z";
  const coach: Coach = {
    id: "manual-coach",
    displayName: "Synthetic Coach",
    identityProvenance: "operator_verified",
    externalProvider: provider,
    externalProviderId: "42",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const alias = proposedCoachProviderAlias(provider, "42", timestamp, coach.id);
  it("accepts the reviewed canonical target without changing the alias", () => {
    expect(
      resolveCoachAssignmentIdentity(provider, "42", alias, coach, coach.id),
    ).toBeUndefined();
    expect(alias.canonicalCoachId).toBe("manual-coach");
  });
  it("accepts an original provider identity with no alias", () => {
    const id = providerEntityId("coach", provider, "42");
    expect(
      resolveCoachAssignmentIdentity(
        provider,
        "42",
        undefined,
        { ...coach, id },
        id,
      ),
    ).toBeUndefined();
  });
  it.each(["", "0", "-1", "1.5", "abc", "042"])(
    "rejects invalid external identity %s",
    (id) => {
      expect(
        resolveCoachAssignmentIdentity(provider, id, alias, coach, coach.id),
      ).toBe("COACH_PROVIDER_MISMATCH");
    },
  );
  it("requires a reviewed alias for a different canonical ID", () => {
    expect(
      resolveCoachAssignmentIdentity(
        provider,
        "42",
        undefined,
        coach,
        coach.id,
      ),
    ).toBe("COACH_ALIAS_MISSING");
  });
  it.each([
    { ...alias, externalProvider: "other-provider" },
    { ...alias, externalProviderCoachId: "43" },
    { ...alias, canonicalCoachId: "other-coach" },
    { ...alias, id: "wrong-alias" },
    { ...alias, canonicalCoachId: "invalid/path" },
  ])("rejects contradictory alias evidence %#", (invalid) => {
    expect(
      resolveCoachAssignmentIdentity(provider, "42", invalid, coach, coach.id),
    ).toBe("COACH_ALIAS_CONFLICT");
  });
  it("requires the canonical target to exist and retain the exact provider pair", () => {
    expect(
      resolveCoachAssignmentIdentity(
        provider,
        "42",
        alias,
        undefined,
        coach.id,
      ),
    ).toBe("COACH_INVALID_IDENTITY");
    for (const incompatible of [
      { ...coach, externalProvider: "other-provider" },
      { ...coach, externalProviderId: "43" },
    ]) {
      expect(
        resolveCoachAssignmentIdentity(
          provider,
          "42",
          alias,
          incompatible,
          coach.id,
        ),
      ).toBe("COACH_PROVIDER_MISMATCH");
    }
  });
});

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
