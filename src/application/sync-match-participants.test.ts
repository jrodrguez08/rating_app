import { describe, expect, it, vi } from "vitest";

import type { Match, Team } from "@/domain/models";
import type { FootballDataProvider, FootballSyncStore } from "@/domain/ports";
import { ProviderError } from "@/lib/providers/api-football/errors";

import {
  providerEntityId,
  syncMatchParticipants,
} from "./sync-match-participants";

describe("participant synchronization identities", () => {
  it("builds stable provider-mapped player and coach IDs", () => {
    expect(providerEntityId("player", "api-football", "10")).toBe(
      providerEntityId("player", "api-football", "10"),
    );
    expect(providerEntityId("player", "api-football", "10")).not.toBe(
      providerEntityId("coach", "api-football", "10"),
    );
  });

  it.each([
    ["S. Rodriguez", "541314", "36237"],
    ["E. Bravo", "669618", "404115"],
    ["K. Estrada", "628817", "512850"],
    ["J. Henestrosa", "593270", "92547"],
  ])(
    "uses the known %s alias for future match participants",
    async (name, legacyExternalPlayerId, canonicalExternalPlayerId) => {
      const store = storeWith();
      await syncMatchParticipants(
        match.id,
        providerWith(legacyExternalPlayerId, name),
        store,
        new Date("2026-09-07T12:00:00.000Z"),
      );
      const canonicalPlayerId = providerEntityId(
        "player",
        "api-football",
        canonicalExternalPlayerId,
      );
      expect(vi.mocked(store.upsertPlayers).mock.calls[0][0][0].id).toBe(
        canonicalPlayerId,
      );
      expect(
        vi.mocked(store.replaceMatchParticipants).mock.calls[0][1][0],
      ).toMatchObject({
        playerId: canonicalPlayerId,
        externalProviderPlayerId: legacyExternalPlayerId,
      });
    },
  );

  it("passes the persisted fixture kickoff into provider context resolution", async () => {
    const store = storeWith();
    const provider = providerWith("known-player");

    await syncMatchParticipants(match.id, provider, store);

    expect(provider.getMatchContext).toHaveBeenCalledWith(
      match.externalProviderFixtureId,
      team.externalProviderId,
      undefined,
      match.kickoffAt,
    );
  });

  it("does not merge unknown players that share a name and shirt", async () => {
    const firstStore = storeWith();
    const secondStore = storeWith();
    await syncMatchParticipants(
      match.id,
      providerWith("unknown-1"),
      firstStore,
    );
    await syncMatchParticipants(
      match.id,
      providerWith("unknown-2"),
      secondStore,
    );
    const firstId = vi.mocked(firstStore.upsertPlayers).mock.calls[0][0][0].id;
    const secondId = vi.mocked(secondStore.upsertPlayers).mock.calls[0][0][0]
      .id;
    expect(firstId).not.toBe(secondId);
  });

  it("rejects an incomplete capture before persisting participant context", async () => {
    const store = storeWith();
    const provider = providerWith("unused");
    provider.getLineupContext = vi.fn().mockResolvedValue({
      participants: Array.from({ length: 10 }, (_, index) => ({
        externalTeamId: "815",
        externalPlayerId: String(8000 + index),
        name: `Partial Starter ${index + 1}`,
        squadRole: "starter" as const,
        participated: true,
      })),
      headCoach: {
        externalTeamId: "815",
        externalCoachId: "coach-1",
        name: "Coach",
      },
    });

    await expect(
      syncMatchParticipants(
        match.id,
        provider,
        store,
        new Date("2026-09-07T11:45:00.000Z"),
        "lineup",
      ),
    ).rejects.toMatchObject({ code: "lineup-unavailable" });
    expect(store.resolvePlayerProviderAliases).not.toHaveBeenCalled();
    expect(store.replaceMatchParticipants).not.toHaveBeenCalled();
  });

  it("recovers ambiguous coach identity with a fixture-bound verified assignment", async () => {
    const store = storeWith();
    const provider = providerWith("known-player");
    provider.getMatchEvidence = vi.fn().mockResolvedValue({
      participants: participantEvidence("known-player"),
      coach: { status: "unavailable", reason: "ambiguous-coach" },
    });
    store.getVerifiedCoachAssignment = vi.fn().mockResolvedValue({
      assignment: {
        matchId: match.id,
        trackedTeamId: team.id,
        externalProvider: "api-football",
        externalFixtureId: match.externalProviderFixtureId,
        coachId: "coach-verified",
        verificationSource: "https://example.com/report",
        verificationReason: "Independent match report confirmation.",
        operatorId: "operator",
        provenance: "operator_verified",
        verifiedAt: "2026-09-07T13:00:00.000Z",
        createdAt: "2026-09-07T13:00:00.000Z",
        updatedAt: "2026-09-07T13:00:00.000Z",
      },
      coach: {
        id: "coach-verified",
        displayName: "Verified Coach",
        identityProvenance: "operator_verified",
        createdAt: "2026-09-07T13:00:00.000Z",
        updatedAt: "2026-09-07T13:00:00.000Z",
      },
    });
    store.replaceMatchParticipantContext = vi.fn().mockResolvedValue({
      players: counts,
      participants: counts,
      coaches: counts,
      coachAssignments: counts,
    });

    const result = await syncMatchParticipants(match.id, provider, store);

    expect(result.coach).toEqual({
      id: "coach-verified",
      name: "Verified Coach",
    });
    expect(store.replaceMatchParticipantContext).toHaveBeenCalledWith(
      match.id,
      expect.objectContaining({
        assignment: expect.objectContaining({
          coachId: "coach-verified",
          provenance: "operator_verified",
        }),
      }),
    );
    expect(store.upsertPlayers).not.toHaveBeenCalled();
  });

  it("fails closed when ambiguous coach identity has no verified assignment", async () => {
    const store = storeWith();
    const provider = providerWith("known-player");
    provider.getMatchEvidence = vi.fn().mockResolvedValue({
      participants: participantEvidence("known-player"),
      coach: { status: "unavailable", reason: "ambiguous-coach" },
    });
    store.getVerifiedCoachAssignment = vi.fn().mockResolvedValue(null);

    await expect(
      syncMatchParticipants(match.id, provider, store),
    ).rejects.toMatchObject({ code: "ambiguous-coach" });
    expect(store.upsertPlayers).not.toHaveBeenCalled();
  });

  it("preserves a trusted provider coach when later coach evidence is unavailable", async () => {
    const store = storeWith();
    store.getMatch = vi.fn().mockResolvedValue({
      ...match,
      lineupSnapshotAt: "2026-09-07T11:30:00.000Z",
    });
    store.getPersistedMatchContext = vi.fn().mockResolvedValue({
      participants: participantEvidence("known-player"),
      headCoach: {
        externalTeamId: "815",
        externalCoachId: "coach-baseline",
        name: "Baseline Coach",
      },
    });
    const provider = providerWith("known-player");
    provider.getMatchEvidence = vi.fn().mockResolvedValue({
      participants: participantEvidence("known-player"),
      coach: { status: "unavailable", reason: "ambiguous-coach" },
    });

    const result = await syncMatchParticipants(match.id, provider, store);

    expect(result.coach).toEqual({
      id: providerEntityId("coach", "api-football", "coach-baseline"),
      name: "Baseline Coach",
    });
  });

  it("rejects a verified assignment whose internal Coach cannot be loaded", async () => {
    const store = storeWith();
    const provider = providerWith("known-player");
    const log = vi.fn();
    store.getVerifiedCoachAssignment = vi
      .fn()
      .mockRejectedValue(new Error("Verified coach identity is missing."));

    await expect(
      syncMatchParticipants(
        match.id,
        provider,
        store,
        new Date("2026-09-07T13:00:00.000Z"),
        "final",
        log,
      ),
    ).rejects.toThrow(/identity is missing/i);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"status":"rejected"'),
    );
    expect(provider.getMatchContext).not.toHaveBeenCalled();
  });

  it("rejects stale fixture bindings", async () => {
    const store = storeWith();
    const provider = providerWith("known-player");
    provider.getMatchEvidence = vi.fn().mockResolvedValue({
      participants: participantEvidence("known-player"),
      coach: {
        status: "resolved",
        value: {
          externalTeamId: "815",
          externalCoachId: "provider-other",
          name: "Other Coach",
        },
      },
    });
    store.getVerifiedCoachAssignment = vi.fn().mockResolvedValue({
      assignment: {
        matchId: match.id,
        trackedTeamId: team.id,
        externalProvider: "api-football",
        externalFixtureId: "wrong-fixture",
        coachId: "coach-verified",
        verificationSource: "https://example.com/report",
        verificationReason: "Independent match report confirmation.",
        operatorId: "operator",
        provenance: "operator_verified",
        verifiedAt: "2026-09-07T13:00:00.000Z",
        createdAt: "2026-09-07T13:00:00.000Z",
        updatedAt: "2026-09-07T13:00:00.000Z",
      },
      coach: {
        id: "coach-verified",
        displayName: "Verified Coach",
        identityProvenance: "operator_verified",
        createdAt: "2026-09-07T13:00:00.000Z",
        updatedAt: "2026-09-07T13:00:00.000Z",
      },
    });

    await expect(
      syncMatchParticipants(match.id, provider, store),
    ).rejects.toThrow(/does not match the fixture/i);
  });

  it("rejects conflicting provider and operator coach identities", async () => {
    const store = storeWith();
    const provider = providerWith("known-player");
    provider.getMatchEvidence = vi.fn().mockResolvedValue({
      participants: participantEvidence("known-player"),
      coach: {
        status: "resolved",
        value: {
          externalTeamId: "815",
          externalCoachId: "provider-other",
          name: "Other Coach",
        },
      },
    });
    store.getVerifiedCoachAssignment = vi.fn().mockResolvedValue({
      assignment: {
        matchId: match.id,
        trackedTeamId: team.id,
        externalProvider: "api-football",
        externalFixtureId: match.externalProviderFixtureId,
        coachId: "coach-verified",
        verificationSource: "https://example.com/report",
        verificationReason: "Independent match report confirmation.",
        operatorId: "operator",
        provenance: "operator_verified",
        verifiedAt: "2026-09-07T13:00:00.000Z",
        createdAt: "2026-09-07T13:00:00.000Z",
        updatedAt: "2026-09-07T13:00:00.000Z",
      },
      coach: {
        id: "coach-verified",
        displayName: "Verified Coach",
        identityProvenance: "operator_verified",
        externalProvider: "api-football",
        externalProviderId: "provider-verified",
        createdAt: "2026-09-07T13:00:00.000Z",
        updatedAt: "2026-09-07T13:00:00.000Z",
      },
    });

    await expect(
      syncMatchParticipants(match.id, provider, store),
    ).rejects.toThrow(/conflicts with the verified assignment/i);
    expect(store.upsertPlayers).not.toHaveBeenCalled();
  });

  it("uses complete manual evidence when provider lineup evidence is unavailable", async () => {
    const store = storeWith();
    store.getVerifiedLineupSnapshot = vi
      .fn()
      .mockResolvedValue(verifiedLineup());
    store.getVerifiedCoachAssignment = vi
      .fn()
      .mockResolvedValue(verifiedCoach());
    store.replaceMatchParticipantContext = vi.fn().mockResolvedValue({
      players: counts,
      participants: counts,
      coaches: counts,
      coachAssignments: counts,
    });
    const provider = providerWith("unused");
    provider.getMatchEvidence = vi
      .fn()
      .mockRejectedValue(
        new ProviderError("lineup-unavailable", "No provider lineup."),
      );
    const logs: string[] = [];

    const result = await syncMatchParticipants(
      match.id,
      provider,
      store,
      new Date(),
      "final",
      (message) => logs.push(message),
    );

    expect(provider.getMatchEvidence).toHaveBeenCalledWith(
      match.externalProviderFixtureId,
      team.externalProviderId,
      undefined,
      match.kickoffAt,
    );
    expect(result).toMatchObject({
      starters: 11,
      substitutes: 0,
      participated: 11,
      unusedSubstitutes: 0,
      coach: { id: "coach-verified", name: "Verified Coach" },
    });
    expect(store.resolvePlayerProviderAliases).toHaveBeenCalledWith([]);
    expect(store.replaceMatchParticipantContext).toHaveBeenCalledWith(
      match.id,
      {
        players: [],
        participants: [],
        coach: expect.objectContaining({ id: "coach-verified" }),
        assignment: expect.objectContaining({
          provenance: "operator_verified",
        }),
      },
    );
    expect(logs.join("\n")).toContain('"identityMode":"manual_only"');
    expect(logs.join("\n")).toContain('"recovery":"verified-lineup"');
  });

  it("keeps provider lineup unavailability retryable without a verified coach", async () => {
    const store = storeWith();
    store.getVerifiedLineupSnapshot = vi
      .fn()
      .mockResolvedValue(verifiedLineup());
    store.getVerifiedCoachAssignment = vi.fn().mockResolvedValue(null);
    store.replaceMatchParticipantContext = vi.fn();
    const provider = providerWith("unused");
    provider.getMatchEvidence = vi
      .fn()
      .mockRejectedValue(
        new ProviderError("lineup-unavailable", "No provider lineup."),
      );

    await expect(
      syncMatchParticipants(match.id, provider, store),
    ).rejects.toMatchObject({
      code: "coach-missing",
    });
    expect(store.replaceMatchParticipantContext).not.toHaveBeenCalled();
  });

  it("preserves mixed verified identities without synthesizing aliases during fallback", async () => {
    const store = storeWith();
    store.getVerifiedLineupSnapshot = vi
      .fn()
      .mockResolvedValue(verifiedLineup("mixed"));
    store.getVerifiedCoachAssignment = vi
      .fn()
      .mockResolvedValue(verifiedCoach());
    store.replaceMatchParticipantContext = vi.fn().mockResolvedValue({
      players: counts,
      participants: counts,
      coaches: counts,
      coachAssignments: counts,
    });
    const provider = providerWith("unused");
    provider.getMatchEvidence = vi
      .fn()
      .mockRejectedValue(
        new ProviderError("lineup-unavailable", "No provider lineup."),
      );
    const logs: string[] = [];

    await syncMatchParticipants(
      match.id,
      provider,
      store,
      new Date(),
      "final",
      (message) => logs.push(message),
    );

    expect(store.resolvePlayerProviderAliases).toHaveBeenCalledWith([]);
    expect(logs.join("\n")).toContain('"identityMode":"mixed"');
  });

  it("does not suppress unrelated provider failures", async () => {
    const store = storeWith();
    store.getVerifiedLineupSnapshot = vi
      .fn()
      .mockResolvedValue(verifiedLineup());
    store.getVerifiedCoachAssignment = vi
      .fn()
      .mockResolvedValue(verifiedCoach());
    store.replaceMatchParticipantContext = vi.fn();
    const provider = providerWith("unused");
    provider.getMatchEvidence = vi
      .fn()
      .mockRejectedValue(
        new ProviderError("request-failed", "Network failed."),
      );

    await expect(
      syncMatchParticipants(match.id, provider, store),
    ).rejects.toMatchObject({
      code: "request-failed",
    });
    expect(store.resolvePlayerProviderAliases).not.toHaveBeenCalled();
  });
});

const team: Team = {
  id: "team",
  displayName: "Tracked",
  shortName: "Tracked",
  countryName: "Costa Rica",
  countryCode: "CR",
  externalProviderId: "815",
  brandingKey: "tracked",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const match: Match = {
  id: "match",
  trackedTeamId: team.id,
  competitionId: "competition",
  seasonId: "season",
  homeTeam: { externalProviderId: "815", name: "Tracked" },
  awayTeam: { externalProviderId: "900", name: "Opponent" },
  kickoffAt: "2026-09-07T12:00:00.000Z",
  status: "finished",
  ratingState: "not_ready",
  score: { home: 1, away: 0 },
  externalProvider: "api-football",
  externalProviderFixtureId: "fixture",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const counts = { created: 1, updated: 0, unchanged: 0 };

function verifiedLineup(identityMode: "manual_only" | "mixed" = "manual_only") {
  const verifiedAt = "2026-09-07T13:00:00.000Z";
  return {
    matchId: match.id,
    trackedTeamId: team.id,
    externalProvider: "api-football",
    externalFixtureId: match.externalProviderFixtureId,
    participants: Array.from({ length: 11 }, (_, index) => ({
      playerId: `verified-player-${index + 1}`,
      playerName: `Verified Player ${index + 1}`,
      squadRole: "starter" as const,
      participationStatus: "confirmed_starter" as const,
      participated: true,
      identityProvenance:
        identityMode === "mixed" && index === 0
          ? ("provider" as const)
          : ("operator_verified" as const),
      ...(identityMode === "mixed" && index === 0
        ? { externalProviderPlayerId: "provider-player-1" }
        : {}),
      verificationSource: "https://example.com/match-report",
      verificationReason: "Independent match report confirmation.",
      verifiedBy: "owner",
      verifiedAt,
    })),
    operatorId: "owner",
    verificationSource: "https://example.com/match-report",
    verificationReason: "Independent match report confirmation.",
    provenance: "operator_verified" as const,
    verifiedAt,
    createdAt: verifiedAt,
    updatedAt: verifiedAt,
  };
}

function verifiedCoach() {
  const verifiedAt = "2026-09-07T13:00:00.000Z";
  return {
    assignment: {
      matchId: match.id,
      trackedTeamId: team.id,
      externalProvider: "api-football",
      externalFixtureId: match.externalProviderFixtureId,
      coachId: "coach-verified",
      verificationSource: "https://example.com/match-report",
      verificationReason: "Independent match report confirmation.",
      operatorId: "owner",
      provenance: "operator_verified" as const,
      verifiedAt,
      createdAt: verifiedAt,
      updatedAt: verifiedAt,
    },
    coach: {
      id: "coach-verified",
      displayName: "Verified Coach",
      identityProvenance: "operator_verified" as const,
      createdAt: verifiedAt,
      updatedAt: verifiedAt,
    },
  };
}

function participantEvidence(externalPlayerId: string) {
  return [
    {
      externalTeamId: "815",
      externalPlayerId,
      name: "Player",
      squadRole: "starter" as const,
      participated: true,
    },
  ];
}

function providerWith(
  externalPlayerId: string,
  name = "S. Rodriguez",
): FootballDataProvider {
  return {
    name: "api-football",
    requestCount: 1,
    getMatchContext: vi.fn().mockResolvedValue({
      participants: [
        {
          externalTeamId: "815",
          externalPlayerId,
          name,
          shirtNumber: 24,
          position: "midfielder",
          squadRole: "starter",
          participated: true,
        },
      ],
      headCoach: {
        externalTeamId: "815",
        externalCoachId: "coach-1",
        name: "Coach",
      },
    }),
    resolveTeam: vi.fn(),
    getCompetitionSeasons: vi.fn(),
    getFixtures: vi.fn(),
    getFixture: vi.fn(),
    getLineupContext: vi.fn(),
    getSquad: vi.fn(),
  };
}

function storeWith(): FootballSyncStore {
  return {
    getTeam: vi.fn().mockResolvedValue(team),
    getMatch: vi.fn().mockResolvedValue(match),
    resolvePlayerProviderAliases: vi.fn(async (aliases) => aliases),
    upsertPlayers: vi.fn().mockResolvedValue(counts),
    replaceMatchParticipants: vi.fn().mockResolvedValue(counts),
    upsertCoaches: vi.fn().mockResolvedValue(counts),
    upsertCoachAssignment: vi.fn().mockResolvedValue(counts),
    updateTeamProviderId: vi.fn(),
    upsertCompetitions: vi.fn(),
    upsertSeasons: vi.fn(),
    upsertMatches: vi.fn(),
    upsertMatchParticipants: vi.fn(),
    getPersistedMatchContext: vi.fn(),
  };
}
