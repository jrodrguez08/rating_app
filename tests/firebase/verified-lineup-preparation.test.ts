import { createHash } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMatchLifecycle } from "@/application/match-lifecycle";
import { syncMatchParticipants } from "@/application/sync-match-participants";
import type { Coach, CoachAssignment, MatchParticipant } from "@/domain/models";
import { playerProviderAliasId } from "@/domain/player-identity";
import type {
  FootballDataProvider,
  ProviderFixture,
  ProviderMatchContext,
} from "@/domain/ports";
import {
  AdminVerifiedLineupCommitError,
  AdminVerifiedLineupRejectedError,
  AdminVerifiedLineupService,
  type AdminVerifiedLineupInput,
} from "@/lib/firebase/admin-lineup";
import { AdminFootballSyncStore } from "@/lib/firebase/server";
import { ProviderError } from "@/lib/providers/api-football/errors";
import {
  adminLineupAuditId,
  hashAdminLineupAction,
  type AdminLineupParticipantAction,
} from "@/lib/server/admin-lineup-action";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `verified-lineup-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminVerifiedLineupService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});
afterAll(() => deleteApp(app));

describe("verified lineup preparation persistence", () => {
  it("previews without writes and atomically applies a verified lineup", async () => {
    const matchId = "lineup-atomic";
    const input = await seedScenario(matchId);
    const before = await database.collection("adminAudit").count().get();

    const preview = await service.preview(input);

    expect(preview).toMatchObject({
      matchId,
      participantCreates: 12,
      internalPlayersCreated: [],
    });
    expect(
      (await database.collection(`matches/${matchId}/participants`).get())
        .empty,
    ).toBe(true);
    expect(
      (await database.collection("adminAudit").count().get()).data(),
    ).toEqual(before.data());

    const token = challengeToken(matchId);
    await seedChallenge(input, token);
    const result = await service.applyAuthorized(input, token);

    expect(result.disposition).toBe("committed");
    expect(result.auditId).toBe(
      adminLineupAuditId(adminChallengeDocumentId(token)),
    );
    const match = (await database.doc(`matches/${matchId}`).get()).data();
    expect(match?.ratingState).toBe("not_ready");
    expect(match).not.toHaveProperty("votingOpensAt");
    const participants = await database
      .collection(`matches/${matchId}/participants`)
      .get();
    expect(participants.size).toBe(12);
    expect(
      participants.docs.filter((snapshot) => snapshot.data().participated),
    ).toHaveLength(11);
    expect(
      participants.docs.find((snapshot) => snapshot.id.endsWith("12"))?.data(),
    ).toMatchObject({
      squadRole: "substitute",
      participationStatus: "unused_substitute",
      participated: false,
      participationProvenance: "operator_verified",
    });
    expect(
      (
        await database.doc(`matches/${matchId}/verifiedLineups/current`).get()
      ).data(),
    ).toMatchObject({
      matchId,
      trackedTeamId: "team-verified",
      externalFixtureId: `fixture-${matchId}`,
      provenance: "operator_verified",
      operatorId: input.operatorId,
    });
  });

  it("records an entered substitute while unused and unconfirmed substitutes stay ineligible", async () => {
    const matchId = "lineup-substitutions";
    const input = await seedScenario(matchId, 14);
    input.participants[11] = {
      ...input.participants[11],
      participationStatus: "confirmed_substitute",
      enteredAtMinute: 64,
    };
    input.participants[13] = {
      ...input.participants[13],
      participationStatus: "unconfirmed",
    };
    const token = challengeToken(matchId);
    await seedChallenge(input, token);

    await service.applyAuthorized(input, token);

    const participants = await database
      .collection(`matches/${matchId}/participants`)
      .orderBy("playerId")
      .get();
    expect(
      participants.docs.filter((item) => item.data().participated),
    ).toHaveLength(12);
    expect(participants.docs[11].data()).toMatchObject({
      participationStatus: "confirmed_substitute",
      participated: true,
      enteredAtMinute: 64,
    });
    expect(participants.docs[12].data()).toMatchObject({
      participationStatus: "unused_substitute",
      participated: false,
    });
    expect(participants.docs[13].data()).toMatchObject({
      participationStatus: "unconfirmed",
      participated: false,
    });
  });

  it("creates an internal-only canonical Player without inventing provider identity", async () => {
    const matchId = "lineup-internal-player";
    const input = await seedScenario(matchId);
    input.participants[11] = {
      playerId: "internal-reviewed-player",
      playerName: "Jugador verificado",
      createInternalIdentity: true,
      squadRole: "substitute",
      participationStatus: "confirmed_substitute",
      enteredAtMinute: 72,
    };
    const token = challengeToken(matchId);
    await seedChallenge(input, token);

    await service.applyAuthorized(input, token);

    const player = (
      await database.doc("players/internal-reviewed-player").get()
    ).data();
    expect(player).toMatchObject({
      displayName: "Jugador verificado",
      identityProvenance: "operator_verified",
      currentTeamId: "team-verified",
    });
    expect(player).not.toHaveProperty("externalProviderId");
    const participant = (
      await database
        .doc(`matches/${matchId}/participants/internal-reviewed-player`)
        .get()
    ).data();
    expect(participant).not.toHaveProperty("externalProviderPlayerId");
  });

  it.each([
    [
      "duplicate player",
      (input: AdminVerifiedLineupInput) => {
        input.participants[11] = { ...input.participants[0] };
      },
    ],
    [
      "ten starters",
      (input: AdminVerifiedLineupInput) => {
        input.participants[10] = {
          ...input.participants[10],
          squadRole: "substitute",
          participationStatus: "unused_substitute",
        };
      },
    ],
    [
      "wrong fixture",
      (input: AdminVerifiedLineupInput) => {
        input.externalFixtureId = "wrong-fixture";
      },
    ],
    [
      "wrong Team",
      (input: AdminVerifiedLineupInput) => {
        input.trackedTeamId = "wrong-team";
      },
    ],
    [
      "invalid evidence",
      (input: AdminVerifiedLineupInput) => {
        input.verificationSource = "http://unsafe.example.test";
      },
    ],
  ])("rejects %s without writes", async (_label, mutate) => {
    const matchId = `lineup-invalid-${createHash("sha256").update(_label).digest("hex").slice(0, 8)}`;
    const input = await seedScenario(matchId);
    mutate(input);

    await expect(service.preview(input)).rejects.toBeInstanceOf(
      AdminVerifiedLineupRejectedError,
    );
    expect(
      (await database.collection(`matches/${matchId}/participants`).get())
        .empty,
    ).toBe(true);
  });

  it("rejects a canonical Player owned by another Team", async () => {
    const matchId = "lineup-wrong-player-team";
    const input = await seedScenario(matchId);
    await database.doc(`players/player-${matchId}-12`).update({
      currentTeamId: "opponent-team",
    });

    await expect(service.preview(input)).rejects.toBeInstanceOf(
      AdminVerifiedLineupRejectedError,
    );
  });

  it("rejects a canonical provider alias that belongs to another Player", async () => {
    const matchId = "lineup-alias-conflict";
    const input = await seedScenario(matchId);
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", `${matchId}-1`)}`,
      )
      .set({
        canonicalPlayerId: "different-player",
        provider: "api-football",
        externalPlayerId: "1",
      });

    await expect(service.preview(input)).rejects.toBeInstanceOf(
      AdminVerifiedLineupRejectedError,
    );
  });

  it.each(["live", "finished"] as const)(
    "allows verified preparation while the match is %s without opening voting",
    async (status) => {
      const matchId = `lineup-${status}`;
      const input = await seedScenario(matchId);
      const token = challengeToken(matchId);
      await seedChallenge(input, token);
      await database.doc(`matches/${matchId}`).update({ status });

      await service.applyAuthorized(input, token);

      const match = (await database.doc(`matches/${matchId}`).get()).data();
      expect(match?.ratingState).toBe("not_ready");
      expect(match).not.toHaveProperty("votingOpensAt");
    },
  );

  it("rolls back every lineup write when the deterministic audit cannot be created", async () => {
    const matchId = "lineup-audit-conflict";
    const input = await seedScenario(matchId);
    const token = challengeToken(matchId);
    await seedChallenge(input, token);
    const auditId = adminLineupAuditId(adminChallengeDocumentId(token));
    await database.doc(`adminAudit/${auditId}`).set({ conflict: true });

    await expect(service.applyAuthorized(input, token)).rejects.toBeInstanceOf(
      AdminVerifiedLineupCommitError,
    );
    expect(
      (await database.collection(`matches/${matchId}/participants`).get())
        .empty,
    ).toBe(true);
    expect(
      (await database.doc(`matches/${matchId}/verifiedLineups/current`).get())
        .exists,
    ).toBe(false);
    expect(
      (
        await database
          .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
          .get()
      ).data(),
    ).not.toHaveProperty("consumedAt");
  });

  it("serializes concurrent apply and returns one durable receipt", async () => {
    const matchId = "lineup-concurrent";
    const input = await seedScenario(matchId);
    const token = challengeToken(matchId);
    await seedChallenge(input, token);

    const results = await Promise.all([
      service.applyAuthorized(input, token),
      service.applyAuthorized(input, token),
    ]);

    expect(results.map(({ disposition }) => disposition).sort()).toEqual([
      "committed",
      "idempotent_retry",
    ]);
    expect(
      (
        await database
          .collection("adminAudit")
          .where("matchId", "==", matchId)
          .where("action", "==", "lineup_preparation_apply")
          .get()
      ).size,
    ).toBe(1);
  });

  it("recovers the exact receipt after voting and results without modifying history", async () => {
    const matchId = "lineup-durable-receipt";
    const input = await seedScenario(matchId);
    const token = challengeToken(matchId);
    await seedChallenge(input, token);
    const committed = await service.applyAuthorized(input, token);
    await Promise.all([
      database.doc(`matches/${matchId}`).update({
        ratingState: "rating_closed",
        status: "finished",
      }),
      database
        .doc(`matches/${matchId}/ballots/voter-1`)
        .set({ immutable: true }),
      database
        .doc(`matches/${matchId}/results/summary`)
        .set({ immutable: true }),
      database
        .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
        .update({ expiresAt: Timestamp.fromMillis(0) }),
    ]);
    const paths = [
      `matches/${matchId}`,
      `matches/${matchId}/participants/player-${matchId}-01`,
      `matches/${matchId}/verifiedLineups/current`,
      `matches/${matchId}/ballots/voter-1`,
      `matches/${matchId}/results/summary`,
      `adminAudit/${committed.auditId}`,
    ];
    const before = await readDocuments(paths);

    await expect(service.applyAuthorized(input, token)).resolves.toEqual({
      ...committed,
      disposition: "idempotent_retry",
    });
    expect(await readDocuments(paths)).toEqual(before);
  });

  it("rejects a new correction after voting opens", async () => {
    const matchId = "lineup-voting-open";
    const input = await seedScenario(matchId);
    const token = challengeToken(matchId);
    await seedChallenge(input, token);
    await database
      .doc(`matches/${matchId}`)
      .update({ ratingState: "rating_ready" });

    await expect(service.applyAuthorized(input, token)).rejects.toBeInstanceOf(
      AdminVerifiedLineupRejectedError,
    );
  });

  it.each(["ballot", "result", "revision"] as const)(
    "rejects a new correction when a protected %s exists",
    async (protectedDocument) => {
      const matchId = `lineup-protected-${protectedDocument}`;
      const input = await seedScenario(matchId);
      const token = challengeToken(matchId);
      await seedChallenge(input, token);
      const path =
        protectedDocument === "ballot"
          ? `matches/${matchId}/ballots/voter-1`
          : protectedDocument === "result"
            ? `matches/${matchId}/results/summary`
            : `matches/${matchId}/resultRevisions/revision-1`;
      await database.doc(path).set({ immutable: true });

      await expect(
        service.applyAuthorized(input, token),
      ).rejects.toBeInstanceOf(AdminVerifiedLineupRejectedError);
      expect(
        (await database.collection(`matches/${matchId}/participants`).get())
          .empty,
      ).toBe(true);
    },
  );

  it("preserves verified participation on matching provider sync and rejects conflicts atomically", async () => {
    const matchId = "lineup-provider-precedence";
    const input = await seedScenario(matchId);
    const token = challengeToken(matchId);
    await seedChallenge(input, token);
    await service.applyAuthorized(input, token);
    const store = new AdminFootballSyncStore(database);
    const timestamp = new Date().toISOString();
    const coach: Coach = {
      id: `coach-${matchId}`,
      displayName: "Director proveedor",
      identityProvenance: "provider",
      externalProvider: "api-football",
      externalProviderId: "77",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const assignment: CoachAssignment = {
      matchId,
      coachId: coach.id,
      teamId: "team-verified",
      externalProviderTeamId: "815",
      role: "head-coach",
      coachName: coach.displayName,
      provenance: "provider",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const providerParticipants = input.participants.map(
      (participant, index): MatchParticipant => ({
        matchId,
        playerId: participant.playerId,
        teamId: "team-verified",
        externalProvider: "api-football",
        externalProviderTeamId: "815",
        externalProviderPlayerId: `${matchId}-${index + 1}`,
        playerName: `Jugador ${index + 1}`,
        squadRole: participant.squadRole,
        starter: participant.squadRole === "starter",
        participated: participant.squadRole === "starter",
        participationStatus:
          participant.squadRole === "starter"
            ? "confirmed_starter"
            : "unused_substitute",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    const players = input.participants.map((participant, index) => ({
      id: participant.playerId,
      displayName: `Jugador ${index + 1}`,
      identityProvenance: "provider" as const,
      currentTeamId: "team-verified",
      externalProvider: "api-football",
      externalProviderId: `${matchId}-${index + 1}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

    await expect(
      store.replaceMatchParticipantContext(matchId, {
        players,
        participants: providerParticipants.slice(0, 5),
        coach,
        assignment,
      }),
    ).resolves.toBeDefined();
    expect(
      (await database.collection(`matches/${matchId}/participants`).get()).size,
    ).toBe(12);
    const before = await readDocuments([
      `matches/${matchId}/participants/player-${matchId}-12`,
      `matches/${matchId}/coachAssignments/head-coach`,
    ]);
    providerParticipants[11] = {
      ...providerParticipants[11],
      participated: true,
      participationStatus: "confirmed_substitute",
    };
    await expect(
      store.replaceMatchParticipantContext(matchId, {
        players,
        participants: providerParticipants,
        coach,
        assignment,
      }),
    ).rejects.toThrow(/conflicts with the verified lineup/i);
    expect(
      await readDocuments([
        `matches/${matchId}/participants/player-${matchId}-12`,
        `matches/${matchId}/coachAssignments/head-coach`,
      ]),
    ).toEqual(before);
    const unexpectedParticipant = {
      ...providerParticipants[0],
      playerId: "unexpected-player",
      externalProviderPlayerId: "unexpected-provider-player",
    };
    await expect(
      store.replaceMatchParticipantContext(matchId, {
        players,
        participants: [unexpectedParticipant],
        coach,
        assignment,
      }),
    ).rejects.toThrow(/identity conflicts with the verified lineup/i);
    await expect(
      store.replaceMatchParticipantContext(matchId, {
        players,
        participants: [
          {
            ...providerParticipants[0],
            squadRole: "substitute",
            starter: false,
          },
        ],
        coach,
        assignment,
      }),
    ).rejects.toThrow(/participation conflicts with the verified lineup/i);
    expect(
      await readDocuments([
        `matches/${matchId}/participants/player-${matchId}-12`,
        `matches/${matchId}/coachAssignments/head-coach`,
      ]),
    ).toEqual(before);
  });

  it("opens the normal rating window from an all-internal verified lineup after provider lineup failure", async () => {
    const matchId = "lineup-manual-lifecycle";
    const teamId = "team-manual-lifecycle";
    const input = await seedScenario(matchId, 11, true, teamId);
    const token = challengeToken(matchId);
    await seedChallenge(input, token);
    await service.applyAuthorized(input, token);
    const verifiedAt = "2026-10-20T22:30:00.000Z";
    await database.doc(`teams/${teamId}`).set({
      displayName: "Equipo verificado",
      shortName: "Verificado",
      countryName: "Costa Rica",
      countryCode: "CR",
      externalProviderId: "815",
      brandingKey: "verified",
      createdAt: Timestamp.fromDate(new Date(verifiedAt)),
      updatedAt: Timestamp.fromDate(new Date(verifiedAt)),
    });
    await database.doc("coaches/coach-manual").set({
      displayName: "Director verificado",
      identityProvenance: "operator_verified",
      createdAt: Timestamp.fromDate(new Date(verifiedAt)),
      updatedAt: Timestamp.fromDate(new Date(verifiedAt)),
    });
    await database
      .doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`)
      .set({
        matchId,
        trackedTeamId: teamId,
        externalProvider: "api-football",
        externalFixtureId: `fixture-${matchId}`,
        coachId: "coach-manual",
        verificationSource: `https://evidence.example.test/${matchId}`,
        verificationReason: "Acta oficial revisada para este partido.",
        operatorId: "owner-verified",
        provenance: "operator_verified",
        verifiedAt: Timestamp.fromDate(new Date(verifiedAt)),
        createdAt: Timestamp.fromDate(new Date(verifiedAt)),
        updatedAt: Timestamp.fromDate(new Date(verifiedAt)),
      });
    const store = new AdminFootballSyncStore(database);
    const provider = new UnavailableLineupProvider(matchId);
    const now = new Date("2026-10-20T23:00:00.000Z");
    const dependencies = {
      teamId,
      provider,
      store,
      now: () => now,
      discoverFixtures: async () => undefined,
      syncParticipants: async (
        selectedMatchId: string,
        currentTime: Date,
        phase: "lineup" | "final",
      ) =>
        syncMatchParticipants(
          selectedMatchId,
          provider,
          store,
          currentTime,
          phase,
        ),
    };
    const aliasCountBefore = (
      await database.collection("playerProviderAliases").count().get()
    ).data().count;

    const first = await runMatchLifecycle(dependencies);
    const ready = await store.getMatch(matchId);
    const participants = await database
      .collection(`matches/${matchId}/participants`)
      .get();
    const aliasCountAfter = (
      await database.collection("playerProviderAliases").count().get()
    ).data().count;
    const second = await runMatchLifecycle({
      ...dependencies,
      now: () => new Date("2026-10-20T23:30:00.000Z"),
    });

    expect(first.action).toBe("rating_ready");
    expect(ready).toMatchObject({
      ratingState: "rating_ready",
      votingOpensAt: now.toISOString(),
      votingClosesAt: "2026-10-21T01:00:00.000Z",
    });
    expect(participants.size).toBe(11);
    expect(
      participants.docs.every(
        (participant) =>
          participant.data().participationProvenance === "operator_verified" &&
          participant.data().externalProviderPlayerId === undefined,
      ),
    ).toBe(true);
    expect(aliasCountAfter).toBe(aliasCountBefore);
    expect(second.action).toBe("idle");
    expect((await store.getMatch(matchId)).votingOpensAt).toBe(
      ready.votingOpensAt,
    );
  });
});

async function seedScenario(
  matchId: string,
  participantCount = 12,
  internalOnly = false,
  teamId = "team-verified",
) {
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: teamId,
    trackedTeamExternalProviderId: "815",
    competitionId: "competition-1",
    seasonId: "season-1",
    homeTeam: { externalProviderId: "815", name: "Equipo local" },
    awayTeam: { externalProviderId: "900", name: "Equipo visitante" },
    kickoffAt: new Date("2026-10-20T22:00:00.000Z"),
    status: "scheduled",
    ratingState: "not_ready",
    score: { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: `fixture-${matchId}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const batch = database.batch();
  const participants: AdminLineupParticipantAction[] = Array.from(
    { length: participantCount },
    (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      const playerId = `player-${matchId}-${number}`;
      if (!internalOnly) {
        batch.set(database.doc(`players/${playerId}`), {
          displayName: `Jugador ${index + 1}`,
          identityProvenance: "provider",
          currentTeamId: teamId,
          externalProvider: "api-football",
          externalProviderId: `${matchId}-${index + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return {
        playerId,
        createInternalIdentity: internalOnly,
        ...(internalOnly ? { playerName: `Jugador ${index + 1}` } : {}),
        squadRole: index < 11 ? ("starter" as const) : ("substitute" as const),
        participationStatus:
          index < 11
            ? ("confirmed_starter" as const)
            : ("unused_substitute" as const),
      };
    },
  );
  await batch.commit();
  return {
    matchId,
    trackedTeamId: teamId,
    externalFixtureId: `fixture-${matchId}`,
    participants,
    verificationSource: `https://evidence.example.test/${matchId}`,
    verificationReason: "Acta oficial revisada para este partido.",
    operatorId: "owner-verified",
  } satisfies AdminVerifiedLineupInput;
}

class UnavailableLineupProvider implements FootballDataProvider {
  readonly name = "api-football";
  requestCount = 0;

  constructor(private readonly matchId: string) {}

  async resolveTeam(): Promise<never> {
    throw new Error("Unexpected team lookup.");
  }

  async getCompetitionSeasons(): Promise<never> {
    throw new Error("Unexpected competition lookup.");
  }

  async getFixtures(): Promise<never> {
    throw new Error("Unexpected fixture discovery.");
  }

  async getFixture(): Promise<ProviderFixture> {
    this.requestCount += 1;
    return {
      externalFixtureId: `fixture-${this.matchId}`,
      externalCompetitionId: "competition-1",
      providerSeason: 2026,
      kickoffAt: "2026-10-20T22:00:00.000Z",
      status: "finished",
      homeTeam: { externalProviderId: "815", name: "Equipo local" },
      awayTeam: { externalProviderId: "900", name: "Equipo visitante" },
      score: { home: 1, away: 0 },
    };
  }

  async getMatchContext(): Promise<ProviderMatchContext> {
    throw new Error("Unexpected legacy context lookup.");
  }

  async getMatchEvidence(): Promise<never> {
    this.requestCount += 3;
    throw new ProviderError(
      "lineup-unavailable",
      "Provider lineups, player statistics, and events are unavailable.",
    );
  }

  async getLineupContext(): Promise<ProviderMatchContext | null> {
    throw new Error("Unexpected pre-match lineup lookup.");
  }

  async getSquad(): Promise<never> {
    throw new Error("Unexpected squad lookup.");
  }
}

async function seedChallenge(input: AdminVerifiedLineupInput, token: string) {
  await database
    .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
    .set({
      operatorUid: input.operatorId,
      matchId: input.matchId,
      actionHash: hashAdminLineupAction(input),
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
}

function challengeToken(seed: string): string {
  return createHash("sha256").update(seed).digest("base64url");
}

async function readDocuments(paths: string[]) {
  return Promise.all(
    paths.map(async (path) => (await database.doc(path).get()).data()),
  );
}
