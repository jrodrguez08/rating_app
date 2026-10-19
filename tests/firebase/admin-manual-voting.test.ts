import { createHash } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatchStatus } from "@/domain/models";
import {
  AdminManualVotingRejectedError,
  AdminManualVotingService,
  type AdminManualVotingInput,
} from "@/lib/firebase/admin-manual-voting";
import {
  AdminBallotService,
  AdminFootballSyncStore,
} from "@/lib/firebase/server";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import { hashAdminManualVotingAction } from "@/lib/server/admin-manual-voting-action";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `manual-voting-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminManualVotingService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});
afterAll(() => deleteApp(app));

describe("manual voting persistence", () => {
  it("repairs fixture 1551706 verified coach materialization and opens the reported 11/5/5 lineup atomically", async () => {
    const input = await seed(
      "match-10a50b08075ca1f0646e5b6d",
      "finished",
      {},
      {
        verifiedCoachOnly: true,
        confirmedSubstituteCount: 5,
        unusedSubstituteCount: 5,
        internalPlayer: true,
      },
    );
    const assignmentReference = database.doc(
      `matches/${input.matchId}/coachAssignments/head-coach`,
    );
    const before = await assignmentReference.get();
    expect(before.exists).toBe(false);

    await expect(service.preview(input)).resolves.toMatchObject({
      verifiedStarterCount: 11,
      confirmedSubstituteCount: 5,
      excludedSubstituteCount: 5,
      verifiedCoachId: "coach-manual",
      coachAssignmentRepaired: true,
    });
    expect((await assignmentReference.get()).exists).toBe(false);

    const token = await seedChallenge(input);
    await expect(service.applyAuthorized(input, token)).resolves.toMatchObject({
      disposition: "committed",
    });
    expect((await assignmentReference.get()).data()).toMatchObject({
      matchId: input.matchId,
      teamId: input.trackedTeamId,
      coachId: "coach-manual",
      coachName: "Director Manual",
      provenance: "operator_verified",
    });
    expect(
      (await database.doc(`matches/${input.matchId}`).get()).data(),
    ).toMatchObject({
      ratingState: "rating_ready",
      votingOpeningMode: "manual",
    });
  });

  it.each(["scheduled", "live", "finished"] as const)(
    "opens atomically from %s without provider evidence and preserves eligibility",
    async (status) => {
      const input = await seed(`manual-open-${status}`, status);
      const token = await seedChallenge(input);

      const preview = await service.preview(input);
      expect(preview).toMatchObject({
        providerStatus: status,
        verificationSource: input.verificationSource,
        verifiedStarterCount: 11,
        confirmedSubstituteCount: 1,
        excludedSubstituteCount: 1,
      });
      expect(preview.durationMinutes).toBe(120);
      const result = await service.applyAuthorized(input, token);
      expect(result.disposition).toBe("committed");

      const match = (
        await database.doc(`matches/${input.matchId}`).get()
      ).data();
      expect(match).toMatchObject({
        ratingState: "rating_ready",
        votingOpeningMode: "manual",
        votingOpenNotificationStatus: "pending",
      });
      expect(
        match?.votingClosesAt.toMillis() - match?.votingOpensAt.toMillis(),
      ).toBe(2 * 60 * 60 * 1000);
      expect(
        (
          await database
            .doc(`matches/${input.matchId}/finalWhistleAttestations/manual`)
            .get()
        ).data(),
      ).toMatchObject({
        actualMatchEnded: true,
        operatorId: input.operatorId,
        providerStatusObserved: status,
      });
      const unused = await database
        .doc(`matches/${input.matchId}/participants/player-${input.matchId}-13`)
        .get();
      expect(unused.data()).toMatchObject({ participated: false });
      const ballot = await new AdminBallotService(database).getPageState(
        input.matchId,
      );
      expect(ballot.state).toBe("active");
      if (ballot.state === "active") {
        expect(ballot.context.players).toHaveLength(12);
        expect(ballot.context.players.map(({ id }) => id)).not.toContain(
          unused.id,
        );
      }

      const retry = await service.applyAuthorized(input, token);
      expect(retry.disposition).toBe("idempotent_retry");
      expect(retry.auditId).toBe(result.auditId);

      const originalOpening = match?.votingOpensAt.toMillis();
      await new AdminFootballSyncStore(database).upsertMatches([
        {
          id: input.matchId,
          trackedTeamId: input.trackedTeamId,
          trackedTeamExternalProviderId: "815",
          competitionId: "competition-1",
          seasonId: "season-1",
          homeTeam: { externalProviderId: "815", name: "Local" },
          awayTeam: { externalProviderId: "900", name: "Visitante" },
          kickoffAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
          status: "live",
          ratingState: "not_ready",
          score: { home: null, away: null },
          externalProvider: "api-football",
          externalProviderFixtureId: input.externalFixtureId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      const refreshed = (
        await database.doc(`matches/${input.matchId}`).get()
      ).data();
      expect(refreshed).toMatchObject({
        status,
        ratingState: "rating_ready",
        votingOpeningMode: "manual",
      });
      expect(refreshed?.votingOpensAt.toMillis()).toBe(originalOpening);

      await new AdminFootballSyncStore(database).upsertMatches([
        {
          id: input.matchId,
          trackedTeamId: input.trackedTeamId,
          trackedTeamExternalProviderId: "815",
          competitionId: "competition-1",
          seasonId: "season-1",
          homeTeam: { externalProviderId: "815", name: "Local" },
          awayTeam: { externalProviderId: "900", name: "Visitante" },
          kickoffAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
          status: "finished",
          ratingState: "not_ready",
          score: { home: 2, away: 1 },
          externalProvider: "api-football",
          externalProviderFixtureId: input.externalFixtureId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      const finishedRefresh = (
        await database.doc(`matches/${input.matchId}`).get()
      ).data();
      expect(finishedRefresh).toMatchObject({
        status,
        ratingState: "rating_ready",
        votingOpeningMode: "manual",
      });
      expect(finishedRefresh?.votingOpensAt.toMillis()).toBe(originalOpening);
      expect(
        (await database.doc(`matches/${input.matchId}/results/summary`).get())
          .exists,
      ).toBe(false);
    },
  );

  it.each(["postponed", "suspended", "cancelled", "abandoned"] as const)(
    "rejects a %s match without writing an attestation or window",
    async (status) => {
      const input = await seed(`manual-status-${status}`, status);
      const token = await seedChallenge(input);

      await expect(service.preview(input)).rejects.toThrow(status);
      await expect(service.applyAuthorized(input, token)).rejects.toThrow(
        status,
      );
      const match = (
        await database.doc(`matches/${input.matchId}`).get()
      ).data();
      expect(match).toMatchObject({
        status,
        ratingState: "preparing_rating",
      });
      expect(match?.votingOpensAt).toBeUndefined();
      expect(
        (
          await database
            .doc(`matches/${input.matchId}/finalWhistleAttestations/manual`)
            .get()
        ).exists,
      ).toBe(false);
    },
  );

  it.each(["cancelled", "abandoned"] as const)(
    "rechecks authoritative status when it becomes %s after preview",
    async (status) => {
      const input = await seed(`manual-race-${status}`, "live");
      const token = await seedChallenge(input);
      await expect(service.preview(input)).resolves.toMatchObject({
        providerStatus: "live",
      });

      await database.doc(`matches/${input.matchId}`).update({ status });

      await expect(service.applyAuthorized(input, token)).rejects.toThrow(
        status,
      );
      const match = (
        await database.doc(`matches/${input.matchId}`).get()
      ).data();
      expect(match?.votingOpensAt).toBeUndefined();
      expect(match?.ratingState).toBe("preparing_rating");
    },
  );

  it("serializes a concurrent lifecycle cancellation and manual apply safely", async () => {
    const input = await seed("manual-concurrent-cancel", "live");
    const token = await seedChallenge(input);
    const lifecycleWrite = new AdminFootballSyncStore(database).upsertMatches([
      {
        id: input.matchId,
        trackedTeamId: input.trackedTeamId,
        trackedTeamExternalProviderId: "815",
        competitionId: "competition-1",
        seasonId: "season-1",
        homeTeam: { externalProviderId: "815", name: "Local" },
        awayTeam: { externalProviderId: "900", name: "Visitante" },
        kickoffAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
        status: "cancelled",
        ratingState: "not_ready",
        score: { home: null, away: null },
        externalProvider: "api-football",
        externalProviderFixtureId: input.externalFixtureId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const [lifecycle, apply] = await Promise.allSettled([
      lifecycleWrite,
      service.applyAuthorized(input, token),
    ]);
    expect(lifecycle.status).toBe("fulfilled");
    const match = (await database.doc(`matches/${input.matchId}`).get()).data();

    if (match?.status === "cancelled") {
      expect(apply.status).toBe("rejected");
      expect(match?.votingOpensAt).toBeUndefined();
      expect(match?.ratingState).toBe("preparing_rating");
    } else {
      expect(apply.status).toBe("fulfilled");
      expect(match).toMatchObject({
        status: "live",
        ratingState: "rating_ready",
        votingOpeningMode: "manual",
      });
    }
  });

  it("requires an explicit final-whistle attestation", async () => {
    const input = await seed("manual-missing-attestation", "live");

    await expect(
      service.preview({
        ...input,
        finalWhistleConfirmed: false,
      } as unknown as AdminManualVotingInput),
    ).rejects.toThrow(/input is invalid/);
  });

  it("does not let a different action reuse an authorization challenge", async () => {
    const input = await seed("manual-action-reuse", "live");
    const token = await seedChallenge(input);

    await expect(
      service.applyAuthorized(
        {
          ...input,
          verificationReason:
            "Una razón diferente con evidencia independiente.",
        },
        token,
      ),
    ).rejects.toThrow(/Invalid challenge/);
    expect(
      (
        await database
          .doc(`matches/${input.matchId}/finalWhistleAttestations/manual`)
          .get()
      ).exists,
    ).toBe(false);
  });

  it("revalidates a custom Costa Rica close at trusted apply time", async () => {
    const input = await seed("manual-custom-expired", "live", {
      closeMode: "custom",
      customClosesAtLocal: "2020-01-01T12:00",
    });
    await expect(service.preview(input)).rejects.toThrow(/invalid or expired/);
  });

  it.each([
    ["missing coach", { omitCoach: true }],
    ["incomplete lineup", { starterCount: 10 }],
    ["material conflict", { conflict: true }],
    ["missing canonical player", { missingPlayer: true }],
    ["conflicting coach identity", { conflictingCoach: true }],
    ["wrong fixture binding", { wrongBinding: true }],
    ["wrong Team binding", { wrongTeamBinding: true }],
  ] as const)("rejects %s without opening voting", async (_, options) => {
    const input = await seed(
      `manual-reject-${_.replaceAll(" ", "-")}`,
      "live",
      {},
      options,
    );
    await expect(service.preview(input)).rejects.toBeInstanceOf(
      AdminManualVotingRejectedError,
    );
    expect(
      (await database.doc(`matches/${input.matchId}`).get()).data(),
    ).toMatchObject({
      ratingState: "preparing_rating",
    });
  });

  it.each(["active", "closed", "published"] as const)(
    "preserves %s voting history",
    async (history) => {
      const input = await seed(`manual-history-${history}`, "live");
      if (history === "active") {
        await database.doc(`matches/${input.matchId}`).update({
          ratingState: "rating_ready",
          votingOpensAt: Timestamp.now(),
          votingClosesAt: Timestamp.fromMillis(Date.now() + 60_000),
        });
      } else {
        await database.doc(`matches/${input.matchId}`).update({
          ratingState: "rating_closed",
        });
        if (history === "published") {
          await database
            .doc(`matches/${input.matchId}/results/summary`)
            .set({ status: "final" });
        }
      }
      await expect(service.preview(input)).rejects.toBeInstanceOf(
        AdminManualVotingRejectedError,
      );
      expect(
        (
          await database
            .doc(`matches/${input.matchId}/finalWhistleAttestations/manual`)
            .get()
        ).exists,
      ).toBe(false);
    },
  );
});

async function seed(
  matchId: string,
  status: MatchStatus,
  override: Partial<AdminManualVotingInput> = {},
  options: {
    omitCoach?: boolean;
    starterCount?: number;
    conflict?: boolean;
    wrongBinding?: boolean;
    missingPlayer?: boolean;
    conflictingCoach?: boolean;
    verifiedCoachOnly?: boolean;
    confirmedSubstituteCount?: number;
    unusedSubstituteCount?: number;
    internalPlayer?: boolean;
    wrongTeamBinding?: boolean;
  } = {},
): Promise<AdminManualVotingInput> {
  const teamId = "team-manual";
  const fixtureId = `fixture-${matchId}`;
  const now = Timestamp.now();
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: options.wrongTeamBinding ? "wrong-team" : teamId,
    trackedTeamExternalProviderId: "815",
    competitionId: "competition-1",
    seasonId: "season-1",
    homeTeam: { externalProviderId: "815", name: "Local" },
    awayTeam: { externalProviderId: "900", name: "Visitante" },
    kickoffAt: Timestamp.fromMillis(Date.now() - 72 * 60 * 60 * 1000),
    status,
    ratingState: "preparing_rating",
    score: { home: null, away: null },
    externalProvider: "api-football",
    externalProviderFixtureId: fixtureId,
    createdAt: now,
    updatedAt: now,
  });
  const starterCount = options.starterCount ?? 11;
  const confirmedSubstituteCount = options.confirmedSubstituteCount ?? 1;
  const unusedSubstituteCount = options.unusedSubstituteCount ?? 1;
  const participants = Array.from(
    { length: 11 + confirmedSubstituteCount + unusedSubstituteCount },
    (_, index) => {
      const playerId = `player-${matchId}-${index + 1}`;
      const starter = index < starterCount;
      const confirmedSubstitute =
        index >= 11 && index < 11 + confirmedSubstituteCount;
      return {
        playerId,
        playerName: `Jugador ${index + 1}`,
        squadRole: starter ? ("starter" as const) : ("substitute" as const),
        participationStatus: starter
          ? ("confirmed_starter" as const)
          : confirmedSubstitute
            ? ("confirmed_substitute" as const)
            : ("unused_substitute" as const),
        participated: starter || confirmedSubstitute,
        identityProvenance:
          options.internalPlayer && index === 0
            ? ("operator_verified" as const)
            : ("provider" as const),
        verificationSource: "https://example.com/lineup",
        verificationReason: "Acta oficial revisada.",
        verifiedBy: "owner-manual",
        verifiedAt: now,
      };
    },
  );
  const batch = database.batch();
  for (const participant of participants) {
    if (!(options.missingPlayer && participant === participants[0])) {
      batch.set(database.doc(`players/${participant.playerId}`), {
        displayName: participant.playerName,
        identityProvenance: participant.identityProvenance,
        createdAt: now,
        updatedAt: now,
      });
    }
    batch.set(
      database.doc(`matches/${matchId}/participants/${participant.playerId}`),
      {
        matchId,
        playerId: participant.playerId,
        teamId,
        externalProviderTeamId: "815",
        playerName: participant.playerName,
        squadRole: participant.squadRole,
        starter: participant.squadRole === "starter",
        participated: participant.participated,
        participationStatus: participant.participationStatus,
        createdAt: now,
        updatedAt: now,
      },
    );
  }
  batch.set(database.doc(`matches/${matchId}/verifiedLineups/current`), {
    matchId,
    trackedTeamId: teamId,
    externalProvider: "api-football",
    externalFixtureId: options.wrongBinding ? "wrong-fixture" : fixtureId,
    participants,
    operatorId: "owner-manual",
    verificationSource: "https://example.com/lineup",
    verificationReason: "Acta oficial revisada.",
    provenance: "operator_verified",
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (!options.omitCoach) {
    batch.set(database.doc("coaches/coach-manual"), {
      displayName: "Director Manual",
      identityProvenance: "operator_verified",
      createdAt: now,
      updatedAt: now,
    });
    batch.set(
      database.doc(`matches/${matchId}/verifiedCoachAssignments/head-coach`),
      {
        matchId,
        trackedTeamId: teamId,
        externalProvider: "api-football",
        externalFixtureId: fixtureId,
        coachId: "coach-manual",
        verificationSource: "https://example.com/coach",
        verificationReason: "Acta oficial revisada.",
        operatorId: "owner-manual",
        provenance: "operator_verified",
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    );
    if (!options.verifiedCoachOnly) {
      batch.set(
        database.doc(`matches/${matchId}/coachAssignments/head-coach`),
        {
          matchId,
          teamId,
          externalProviderTeamId: "815",
          coachId: options.conflictingCoach ? "coach-other" : "coach-manual",
          coachName: "Director Manual",
          role: "head-coach",
          provenance: "operator_verified",
          createdAt: now,
          updatedAt: now,
        },
      );
    }
  }
  if (options.conflict) {
    batch.set(
      database.doc(`matches/${matchId}/lineupReconciliations/provider`),
      {
        matchId,
        trackedTeamId: teamId,
        externalProvider: "api-football",
        externalFixtureId: fixtureId,
        status: "conflict",
        reason: "Provider differs materially.",
        observedAt: now,
      },
    );
  }
  await batch.commit();
  return {
    matchId,
    trackedTeamId: teamId,
    externalFixtureId: fixtureId,
    finalWhistleConfirmed: true,
    verificationSource: "https://example.com/final-whistle",
    verificationReason: "Pitazo final confirmado en el acta oficial.",
    closeMode: "default",
    operatorId: "owner-manual",
    ...override,
  };
}

async function seedChallenge(input: AdminManualVotingInput) {
  const token = createHash("sha256").update(input.matchId).digest("base64url");
  await database
    .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
    .set({
      operatorUid: input.operatorId,
      matchId: input.matchId,
      actionHash: hashAdminManualVotingAction(input),
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
  return token;
}
