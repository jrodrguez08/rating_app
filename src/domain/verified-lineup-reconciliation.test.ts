import { describe, expect, it } from "vitest";

import type {
  MatchParticipant,
  ParticipationStatus,
  VerifiedLineupParticipant,
  VerifiedLineupReconciliation,
  VerifiedLineupSnapshot,
} from "@/domain/models";

import {
  compareVerifiedLineupEvidence,
  selectDurableVerifiedLineupReconciliation,
} from "./verified-lineup-reconciliation";

describe("verified lineup evidence comparison", () => {
  it("matches complete canonical starting evidence", () => {
    const verified = snapshot(starters());

    expect(
      compareVerifiedLineupEvidence(verified, providerFrom(verified)),
    ).toEqual({
      status: "matched",
      reason: "provider-evidence-compatible",
      providerParticipantCount: 11,
    });
  });

  it("matches provider aliases that resolve to the same canonical Players", () => {
    const verified = snapshot(starters());
    const provider = providerFrom(verified).map((participant, index) => ({
      ...participant,
      externalProviderPlayerId: `observed-alias-${index + 1}`,
    }));

    expect(compareVerifiedLineupEvidence(verified, provider).status).toBe(
      "matched",
    );
  });

  it.each([
    [
      "same count with a different canonical Player",
      replaceIdentity,
      "provider-canonical-identity-conflict",
    ],
    [
      "a provider superset",
      addExtraIdentity,
      "provider-canonical-identity-conflict",
    ],
    [
      "a starter and substitute role disagreement",
      swapFirstRole,
      "provider-role-conflict",
    ],
    [
      "duplicate canonical provider identities",
      duplicateIdentity,
      "provider-canonical-identity-duplicate",
    ],
  ] as const)("reports conflict for %s", (_label, change, reason) => {
    const verified = snapshot([
      ...starters(),
      substitute("bench-1", "unused_substitute"),
    ]);

    expect(
      compareVerifiedLineupEvidence(verified, change(providerFrom(verified))),
    ).toMatchObject({ status: "conflict", reason });
  });

  it("reports partial when a provider response omits a starter", () => {
    const verified = snapshot(starters());

    expect(
      compareVerifiedLineupEvidence(
        verified,
        providerFrom(verified).slice(0, 10),
      ),
    ).toMatchObject({
      status: "provider_partial",
      reason: "provider-identities-incomplete",
    });
  });

  it("does not match an internal-only identity without a proven provider mapping", () => {
    const participants = starters();
    participants[0] = {
      ...participants[0],
      identityProvenance: "operator_verified",
      externalProviderPlayerId: undefined,
    };
    const verified = snapshot(participants);

    expect(
      compareVerifiedLineupEvidence(verified, providerFrom(verified)),
    ).toMatchObject({
      status: "provider_partial",
      reason: "verified-internal-identity-unresolved",
    });
  });

  it("matches a confirmed entering substitute", () => {
    const verified = snapshot([
      ...starters(),
      substitute("bench-entered", "confirmed_substitute"),
    ]);

    expect(
      compareVerifiedLineupEvidence(verified, providerFrom(verified)).status,
    ).toBe("matched");
  });

  it.each(["unused_substitute", "unconfirmed"] as const)(
    "reports conflict when provider evidence confirms entry against %s evidence",
    (participationStatus) => {
      const verified = snapshot([
        ...starters(),
        substitute("bench-conflict", participationStatus),
      ]);
      const provider = providerFrom(verified);
      provider[11] = {
        ...provider[11],
        participated: true,
        participationStatus: "confirmed_substitute",
        enteredAtMinute: 62,
      };

      expect(compareVerifiedLineupEvidence(verified, provider)).toMatchObject({
        status: "conflict",
        reason: "provider-participation-conflict",
      });
    },
  );

  it("treats unknown substitute entry evidence as partial", () => {
    const verified = snapshot([
      ...starters(),
      substitute("bench-entered", "confirmed_substitute"),
    ]);
    const provider = providerFrom(verified);
    provider[11] = {
      ...provider[11],
      participated: false,
      participationStatus: "unconfirmed",
      enteredAtMinute: undefined,
    };

    expect(compareVerifiedLineupEvidence(verified, provider)).toMatchObject({
      status: "provider_partial",
      reason: "provider-participation-incomplete",
    });
  });

  it("does not treat bench membership alone as confirmed participation", () => {
    const verified = snapshot([
      ...starters(),
      substitute("bench-entered", "confirmed_substitute"),
    ]);
    const provider = providerFrom(verified);
    provider[11] = {
      ...provider[11],
      participated: false,
      participationStatus: undefined,
      enteredAtMinute: undefined,
    };

    expect(compareVerifiedLineupEvidence(verified, provider).status).toBe(
      "provider_partial",
    );
  });

  it("keeps unused and unconfirmed evidence distinct", () => {
    const unused = snapshot([
      ...starters(),
      substitute("bench-1", "unused_substitute"),
    ]);
    const unconfirmed = snapshot([
      ...starters(),
      substitute("bench-1", "unconfirmed"),
    ]);
    const provider = providerFrom(unused);

    expect(compareVerifiedLineupEvidence(unused, provider).status).toBe(
      "matched",
    );
    expect(compareVerifiedLineupEvidence(unconfirmed, provider).status).toBe(
      "provider_partial",
    );
  });

  it("reports missing when no provider participant evidence is usable", () => {
    expect(
      compareVerifiedLineupEvidence(snapshot(starters()), []),
    ).toMatchObject({
      status: "provider_missing",
      providerParticipantCount: 0,
    });
  });
});

describe("durable verified lineup reconciliation transitions", () => {
  it.each([
    ["matched", "provider_missing"],
    ["conflict", "provider_partial"],
    ["conflict", "provider_missing"],
  ] as const)("preserves %s across a later %s observation", (before, after) => {
    const existing = receipt(before, "established", 12);
    const incoming = receipt(
      after,
      "incomplete",
      after === "provider_missing" ? 0 : 8,
    );

    expect(selectDurableVerifiedLineupReconciliation(existing, incoming)).toBe(
      existing,
    );
  });

  it("keeps repeated identical reconciliation idempotent", () => {
    const existing = receipt("provider_partial", "incomplete", 8);
    const incoming = { ...existing, observedAt: "2026-10-21T00:05:00.000Z" };

    expect(selectDurableVerifiedLineupReconciliation(existing, incoming)).toBe(
      existing,
    );
  });

  it("accepts stronger partial and genuine conclusive updated evidence", () => {
    const missing = receipt("provider_missing", "missing", 0);
    const partial = receipt("provider_partial", "partial", 8);
    const conflict = receipt("conflict", "role-conflict", 12);
    const matched = {
      ...receipt("matched", "compatible", 12),
      observedAt: "2026-10-21T00:05:00.000Z",
    };

    expect(selectDurableVerifiedLineupReconciliation(missing, partial)).toBe(
      partial,
    );
    expect(selectDurableVerifiedLineupReconciliation(partial, conflict)).toBe(
      conflict,
    );
    expect(selectDurableVerifiedLineupReconciliation(conflict, matched)).toBe(
      matched,
    );
  });

  it("does not let an older conclusive observation replace newer evidence", () => {
    const newer = receipt("conflict", "role-conflict", 12);
    const older = {
      ...receipt("matched", "compatible", 12),
      observedAt: "2026-10-20T23:59:00.000Z",
    };

    expect(selectDurableVerifiedLineupReconciliation(newer, older)).toBe(newer);
  });

  it("prefers conflict when simultaneous conclusive observations disagree", () => {
    const matched = receipt("matched", "compatible", 12);
    const conflict = receipt("conflict", "role-conflict", 12);

    expect(selectDurableVerifiedLineupReconciliation(matched, conflict)).toBe(
      conflict,
    );
    expect(selectDurableVerifiedLineupReconciliation(conflict, matched)).toBe(
      conflict,
    );
  });

  it("rejects a persisted fixture binding mismatch", () => {
    expect(() =>
      selectDurableVerifiedLineupReconciliation(
        receipt("matched", "compatible", 11),
        { ...receipt("matched", "compatible", 11), externalFixtureId: "other" },
      ),
    ).toThrow(/binding conflicts/i);
  });
});

function starters(): VerifiedLineupParticipant[] {
  return Array.from({ length: 11 }, (_, index) => ({
    playerId: `player-${index + 1}`,
    playerName: `Player ${index + 1}`,
    squadRole: "starter",
    participationStatus: "confirmed_starter",
    participated: true,
    identityProvenance: "provider",
    externalProviderPlayerId: `provider-${index + 1}`,
    verificationSource: "https://evidence.example.test/match",
    verificationReason: "Reviewed fixture evidence.",
    verifiedBy: "owner",
    verifiedAt: "2026-10-20T23:00:00.000Z",
  }));
}

function substitute(
  playerId: string,
  participationStatus: ParticipationStatus,
): VerifiedLineupParticipant {
  const participated = participationStatus === "confirmed_substitute";
  return {
    playerId,
    playerName: playerId,
    squadRole: "substitute",
    participationStatus,
    participated,
    identityProvenance: "provider",
    externalProviderPlayerId: `provider-${playerId}`,
    ...(participated ? { enteredAtMinute: 60 } : {}),
    verificationSource: "https://evidence.example.test/match",
    verificationReason: "Reviewed fixture evidence.",
    verifiedBy: "owner",
    verifiedAt: "2026-10-20T23:00:00.000Z",
  };
}

function snapshot(
  participants: VerifiedLineupParticipant[],
): VerifiedLineupSnapshot {
  return {
    matchId: "match-1",
    trackedTeamId: "team-1",
    externalProvider: "api-football",
    externalFixtureId: "fixture-1",
    participants,
    operatorId: "owner",
    verificationSource: "https://evidence.example.test/match",
    verificationReason: "Reviewed fixture evidence.",
    provenance: "operator_verified",
    verifiedAt: "2026-10-20T23:00:00.000Z",
    createdAt: "2026-10-20T23:00:00.000Z",
    updatedAt: "2026-10-20T23:00:00.000Z",
  };
}

function providerFrom(verified: VerifiedLineupSnapshot): MatchParticipant[] {
  return verified.participants.map((participant) => ({
    matchId: verified.matchId,
    playerId: participant.playerId,
    teamId: verified.trackedTeamId,
    externalProvider: verified.externalProvider,
    externalProviderTeamId: "815",
    externalProviderPlayerId: participant.externalProviderPlayerId,
    playerName: participant.playerName,
    squadRole: participant.squadRole,
    starter: participant.squadRole === "starter",
    participated: participant.participated,
    participationStatus: participant.participationStatus,
    identityProvenance: "provider",
    participationProvenance: "provider",
    enteredAtMinute: participant.enteredAtMinute,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  }));
}

function replaceIdentity(participants: MatchParticipant[]): MatchParticipant[] {
  return participants.map((participant, index) =>
    index === 0
      ? { ...participant, playerId: "different-canonical-player" }
      : participant,
  );
}

function addExtraIdentity(
  participants: MatchParticipant[],
): MatchParticipant[] {
  return [
    ...participants,
    {
      ...participants[0],
      playerId: "extra-player",
      externalProviderPlayerId: "extra-provider-player",
    },
  ];
}

function swapFirstRole(participants: MatchParticipant[]): MatchParticipant[] {
  return participants.map((participant, index) =>
    index === 0
      ? {
          ...participant,
          squadRole: "substitute" as const,
          starter: false,
          participationStatus: "confirmed_substitute" as const,
        }
      : participant,
  );
}

function duplicateIdentity(
  participants: MatchParticipant[],
): MatchParticipant[] {
  return participants.map((participant, index) =>
    index === 1
      ? { ...participant, playerId: participants[0].playerId }
      : participant,
  );
}

function receipt(
  status: VerifiedLineupReconciliation["status"],
  reason: string,
  providerParticipantCount: number,
): VerifiedLineupReconciliation {
  return {
    matchId: "match-1",
    trackedTeamId: "team-1",
    externalProvider: "api-football",
    externalFixtureId: "fixture-1",
    status,
    reason,
    observedAt: "2026-10-21T00:00:00.000Z",
    providerParticipantCount,
  };
}
