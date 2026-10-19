import { createHash } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  providerEntityId,
  playerProviderAliasId,
} from "@/domain/player-identity";
import {
  AdminPlayerIdentityRejectedError,
  AdminPlayerIdentityService,
  type AdminPlayerIdentityInput,
} from "@/lib/firebase/admin-player-identity";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import {
  adminPlayerIdentityResourceId,
  hashAdminPlayerIdentityAction,
} from "@/lib/server/admin-player-identity-action";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `admin-player-identity-${Date.now()}`);
const database = getFirestore(app);
const service = new AdminPlayerIdentityService(database);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
});

afterAll(() => deleteApp(app));

describe("admin Player identity reconciliation", () => {
  it("links the provider identity while preserving immutable history", async () => {
    const input = identityInput("link");
    const providerPlayerId = await seedIdentityScenario(input, {
      participant: true,
      draft: true,
      verifiedLineup: true,
    });
    const verifiedPath = `matches/match-link/verifiedLineups/current`;
    const verifiedBefore = (await database.doc(verifiedPath).get()).data();

    const preview = await service.preview(input);

    expect(preview).toMatchObject({
      decision: "match",
      preservedReferences: {
        providerParticipations: 1,
        verifiedLineups: 1,
        ownerDrafts: 1,
      },
    });
    expect(
      (
        await database
          .doc(
            `playerProviderAliases/${playerProviderAliasId("api-football", input.externalProviderPlayerId)}`,
          )
          .get()
      ).exists,
    ).toBe(false);

    const token = await seedChallenge(input, "link");
    const first = await service.applyAuthorized(input, token);
    const retry = await service.applyAuthorized(input, token);

    expect(first.disposition).toBe("committed");
    expect(retry).toMatchObject({
      disposition: "idempotent_retry",
      auditId: first.auditId,
    });
    expect(
      (
        await database
          .doc(
            `playerProviderAliases/${playerProviderAliasId("api-football", input.externalProviderPlayerId)}`,
          )
          .get()
      ).data(),
    ).toMatchObject({ canonicalPlayerId: input.canonicalPlayerId });
    expect(
      (await database.doc(`players/${input.canonicalPlayerId}`).get()).data(),
    ).toMatchObject({
      displayName: "Nombre verificado",
      identityProvenance: "operator_verified",
      externalProviderId: input.externalProviderPlayerId,
    });
    expect(
      (await database.doc(`players/${providerPlayerId}`).get()).exists,
    ).toBe(true);
    expect((await database.doc(verifiedPath).get()).data()).toEqual(
      verifiedBefore,
    );
    const draft = (
      await database
        .doc(`matches/match-link/lineupDrafts/${input.operatorId}`)
        .get()
    ).data();
    expect(draft?.participants[0]).toMatchObject({
      playerId: input.canonicalPlayerId,
      createInternalIdentity: false,
    });
    expect(draft?.participants[0]).not.toHaveProperty(
      "identityAllocationToken",
    );
  });

  it("records a reviewed nonmatch without creating an alias", async () => {
    const input = {
      ...identityInput("nonmatch"),
      decision: "nonmatch" as const,
    };
    const providerPlayerId = await seedIdentityScenario(input);
    await database.doc(`players/${providerPlayerId}`).update({
      displayName: "Nombre verificado",
    });
    const token = await seedChallenge(input, "nonmatch");

    await service.applyAuthorized(input, token);

    expect(
      (
        await database
          .doc(
            `playerProviderAliases/${playerProviderAliasId("api-football", input.externalProviderPlayerId)}`,
          )
          .get()
      ).exists,
    ).toBe(false);
    const reviews = await database
      .collection("playerIdentityReviews")
      .where("canonicalPlayerId", "==", input.canonicalPlayerId)
      .get();
    expect(reviews.docs[0]?.data()).toMatchObject({
      decision: "nonmatch",
      status: "active",
      operatorId: input.operatorId,
    });
  });

  it("links late provider evidence before a provider Player document exists", async () => {
    const input = identityInput("late");
    await seedIdentityScenario(input, {
      participant: true,
      providerDocument: false,
    });
    const token = await seedChallenge(input, "late");

    await service.applyAuthorized(input, token);

    expect(
      (
        await database
          .doc(
            `playerProviderAliases/${playerProviderAliasId("api-football", input.externalProviderPlayerId)}`,
          )
          .get()
      ).data(),
    ).toMatchObject({ canonicalPlayerId: input.canonicalPlayerId });
    expect(
      (await database.doc(`players/${input.canonicalPlayerId}`).get()).data(),
    ).toMatchObject({
      displayName: "Nombre verificado",
      externalProviderId: input.externalProviderPlayerId,
    });
  });

  it("rejects a provider alias already reviewed for another canonical Player", async () => {
    const input = identityInput("conflict");
    await seedIdentityScenario(input);
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", input.externalProviderPlayerId)}`,
      )
      .set({
        canonicalPlayerId: `player-internal-${"f".repeat(32)}`,
        canonicalExternalProviderPlayerId: input.externalProviderPlayerId,
        externalProvider: "api-football",
        externalProviderPlayerId: input.externalProviderPlayerId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

    await expect(service.preview(input)).rejects.toBeInstanceOf(
      AdminPlayerIdentityRejectedError,
    );
  });

  it("commits one mutation and returns one receipt for concurrent exact applies", async () => {
    const input = identityInput("concurrent");
    await seedIdentityScenario(input);
    const token = await seedChallenge(input, "concurrent");

    const results = await Promise.all([
      service.applyAuthorized(input, token),
      service.applyAuthorized(input, token),
    ]);

    expect(results.map(({ disposition }) => disposition).sort()).toEqual([
      "committed",
      "idempotent_retry",
    ]);
    expect(new Set(results.map(({ auditId }) => auditId)).size).toBe(1);
  });

  it("rejects reconciliation across protected published history", async () => {
    const input = identityInput("protected");
    const providerPlayerId = await seedIdentityScenario(input);
    await database.doc("matches/result-protected/results/summary").set({
      matchId: "result-protected",
      teamId: input.trackedTeamId,
      ballotCount: 1,
      playerResults: {
        [providerPlayerId]: {
          playerId: providerPlayerId,
          average: 8,
          voteCount: 1,
        },
      },
      coachResult: {
        coachId: "coach-1",
        coachName: "Coach",
        average: 8,
        voteCount: 1,
      },
      mvpPlayerIds: [providerPlayerId],
      status: "final",
      generatedAt: Timestamp.now(),
    });

    await expect(service.preview(input)).rejects.toBeInstanceOf(
      AdminPlayerIdentityRejectedError,
    );
    expect(
      (
        await database
          .doc(
            `playerProviderAliases/${playerProviderAliasId("api-football", input.externalProviderPlayerId)}`,
          )
          .get()
      ).exists,
    ).toBe(false);
  });
});

function identityInput(seed: string): AdminPlayerIdentityInput {
  const numericId = String(
    700_000 +
      [...seed].reduce(
        (total, character) => total + character.charCodeAt(0),
        0,
      ),
  );
  return {
    canonicalPlayerId: `player-internal-${createHash("md5").update(seed).digest("hex")}`,
    trackedTeamId: `team-${seed}`,
    externalProvider: "api-football",
    externalProviderPlayerId: numericId,
    decision: "match",
    verificationSource: `https://evidence.example.test/${seed}`,
    verificationReason:
      "Identidad revisada contra evidencia oficial independiente.",
    operatorId: `owner-${seed}`,
  };
}

async function seedIdentityScenario(
  input: AdminPlayerIdentityInput,
  options: {
    participant?: boolean;
    draft?: boolean;
    verifiedLineup?: boolean;
    providerDocument?: boolean;
  } = {},
): Promise<string> {
  const providerPlayerId = providerEntityId(
    "player",
    input.externalProvider,
    input.externalProviderPlayerId,
  );
  const timestamp = Timestamp.fromDate(new Date("2026-10-18T12:00:00.000Z"));
  await database.doc(`players/${input.canonicalPlayerId}`).set({
    displayName: "Nombre verificado",
    identityProvenance: "operator_verified",
    currentTeamId: input.trackedTeamId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (options.providerDocument !== false) {
    await database.doc(`players/${providerPlayerId}`).set({
      displayName: "Nombre proveedor",
      identityProvenance: "provider",
      currentTeamId: input.trackedTeamId,
      externalProvider: input.externalProvider,
      externalProviderId: input.externalProviderPlayerId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  if (options.participant) {
    const matchId = `match-${input.operatorId.replace("owner-", "")}`;
    await database.doc(`matches/${matchId}`).set({
      trackedTeamId: input.trackedTeamId,
      ratingState: "not_ready",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await database
      .doc(`matches/${matchId}/participants/${providerPlayerId}`)
      .set({
        matchId,
        playerId: providerPlayerId,
        teamId: input.trackedTeamId,
        externalProvider: input.externalProvider,
        externalProviderTeamId: "815",
        externalProviderPlayerId: input.externalProviderPlayerId,
        playerName: "Nombre proveedor",
        squadRole: "starter",
        starter: true,
        participated: true,
        participationStatus: "confirmed_starter",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    if (options.verifiedLineup) {
      await database.doc(`matches/${matchId}/verifiedLineups/current`).set({
        participants: [
          { playerId: providerPlayerId, playerName: "Nombre proveedor" },
        ],
        provenance: "operator_verified",
        createdAt: timestamp,
      });
    }
    if (options.draft) {
      await database
        .doc(`matches/${matchId}/lineupDrafts/${input.operatorId}`)
        .set({
          matchId,
          trackedTeamId: input.trackedTeamId,
          externalFixtureId: "fixture-link",
          ownerId: input.operatorId,
          version: 1,
          contentHash: "before",
          participants: [
            {
              playerId: providerPlayerId,
              playerName: "Nombre proveedor",
              createInternalIdentity: false,
              squadRole: "starter",
              participationStatus: "confirmed_starter",
            },
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
        });
    }
  }
  return providerPlayerId;
}

async function seedChallenge(
  input: AdminPlayerIdentityInput,
  seed: string,
): Promise<string> {
  const token = createHash("sha256").update(seed).digest("base64url");
  await database
    .doc(`adminActionChallenges/${adminChallengeDocumentId(token)}`)
    .set({
      operatorUid: input.operatorId,
      resourceId: adminPlayerIdentityResourceId(input),
      actionHash: hashAdminPlayerIdentityAction(input),
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
  return token;
}
