import { createHash } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { proposedPlayerProviderAlias } from "@/config/player-identity-reconciliations";
import {
  providerEntityId,
  playerProviderAliasId,
} from "@/domain/player-identity";
import {
  AdminPlayerIdentityRejectedError,
  AdminPlayerIdentityService,
  type AdminPlayerIdentityInput,
} from "@/lib/firebase/admin-player-identity";
import { AdminFootballSyncStore } from "@/lib/firebase/server";
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
  it.each([
    {
      id: "missing-canonical",
      label: "inherits the duplicate photo when the canonical photo is missing",
      canonicalPhotoUrl: undefined,
      duplicatePhotoUrl:
        "https://media.api-sports.io/football/players/1001.png",
      expectedPhotoUrl: "https://media.api-sports.io/football/players/1001.png",
      describesFallback: true,
    },
    {
      id: "existing-canonical",
      label: "keeps the existing canonical photo",
      canonicalPhotoUrl:
        "https://media.api-sports.io/football/players/1002.png",
      duplicatePhotoUrl:
        "https://media.api-sports.io/football/players/1003.png",
      expectedPhotoUrl: "https://media.api-sports.io/football/players/1002.png",
      describesFallback: false,
    },
    {
      id: "both-missing",
      label: "adds no photo when neither identity has one",
      canonicalPhotoUrl: undefined,
      duplicatePhotoUrl: undefined,
      expectedPhotoUrl: undefined,
      describesFallback: false,
    },
    {
      id: "missing-duplicate",
      label: "keeps the canonical photo when the duplicate has none",
      canonicalPhotoUrl:
        "https://media.api-sports.io/football/players/1004.png",
      duplicatePhotoUrl: undefined,
      expectedPhotoUrl: "https://media.api-sports.io/football/players/1004.png",
      describesFallback: false,
    },
  ])("$label", async (photoCase) => {
    const seed = `photo-${photoCase.id}`;
    const input = identityInput(seed);
    const providerPlayerId = await seedIdentityScenario(input, {
      canonicalPhotoUrl: photoCase.canonicalPhotoUrl,
      providerPhotoUrl: photoCase.duplicatePhotoUrl,
    });
    const canonicalReference = database.doc(
      `players/${input.canonicalPlayerId}`,
    );
    const duplicateReference = database.doc(`players/${providerPlayerId}`);
    const before = await database.getAll(
      canonicalReference,
      duplicateReference,
    );

    const preview = await service.preview(input);

    expect(
      preview.proposedChanges.some((change) =>
        change.includes("Completar la foto"),
      ),
    ).toBe(photoCase.describesFallback);
    const afterPreview = await database.getAll(
      canonicalReference,
      duplicateReference,
    );
    expect(afterPreview.map((snapshot) => snapshot.data())).toEqual(
      before.map((snapshot) => snapshot.data()),
    );

    const token = await seedChallenge(input, seed);
    const first = await service.applyAuthorized(input, token);
    const afterFirst = await database.getAll(
      canonicalReference,
      duplicateReference,
    );
    const retry = await service.applyAuthorized(input, token);
    const afterRetry = await database.getAll(
      canonicalReference,
      duplicateReference,
    );

    expect(first.disposition).toBe("committed");
    expect(retry.disposition).toBe("idempotent_retry");
    expect(afterRetry.map((snapshot) => snapshot.data())).toEqual(
      afterFirst.map((snapshot) => snapshot.data()),
    );
    expect(afterFirst[0].data()).toMatchObject({
      displayName: "Nombre verificado",
      identityProvenance: "operator_verified",
    });
    if (photoCase.expectedPhotoUrl === undefined) {
      expect(afterFirst[0].data()).not.toHaveProperty("photoUrl");
    } else {
      expect(afterFirst[0].data()?.photoUrl).toBe(photoCase.expectedPhotoUrl);
    }
    expect(afterFirst[1].data()).toEqual(before[1].data());
  });

  it("links the provider identity while preserving immutable history", async () => {
    const input = identityInput("link");
    const providerPlayerId = await seedIdentityScenario(input, {
      participant: true,
      draft: true,
      verifiedLineup: true,
      providerPhotoUrl: "https://media.api-sports.io/football/players/2001.png",
    });
    const verifiedPath = `matches/match-link/verifiedLineups/current`;
    const verifiedBefore = (await database.doc(verifiedPath).get()).data();

    const preview = await service.preview(input);

    expect(preview).toMatchObject({
      decision: "match",
      preservedReferences: {
        duplicateParticipations: 1,
        verifiedLineups: 1,
        ownerDrafts: 1,
      },
    });
    expect(
      (
        await database
          .doc(
            `playerProviderAliases/${playerProviderAliasId("api-football", externalIdFor(input))}`,
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
            `playerProviderAliases/${playerProviderAliasId("api-football", externalIdFor(input))}`,
          )
          .get()
      ).data(),
    ).toMatchObject({ canonicalPlayerId: input.canonicalPlayerId });
    expect(
      (await database.doc(`players/${input.canonicalPlayerId}`).get()).data(),
    ).toMatchObject({
      displayName: "Nombre verificado",
      identityProvenance: "operator_verified",
      externalProviderId: externalIdFor(input),
      photoUrl: "https://media.api-sports.io/football/players/2001.png",
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
    const syncStore = new AdminFootballSyncStore(database);
    const [laterAlias] = await syncStore.resolvePlayerProviderAliases([
      proposedPlayerProviderAlias(
        "api-football",
        externalIdFor(input),
        "2026-10-20T12:00:00.000Z",
      ),
    ]);
    expect(laterAlias.canonicalPlayerId).toBe(input.canonicalPlayerId);
    await syncStore.upsertPlayers([
      {
        id: laterAlias.canonicalPlayerId,
        displayName: "Nombre nuevo del proveedor",
        identityProvenance: "provider",
        currentTeamId: input.trackedTeamId,
        externalProvider: "api-football",
        externalProviderId: laterAlias.canonicalExternalProviderPlayerId,
        photoUrl: "https://media.api-sports.io/football/players/2999.png",
        createdAt: "2026-10-20T12:00:00.000Z",
        updatedAt: "2026-10-20T12:00:00.000Z",
      },
    ]);
    expect(
      (await database.doc(`players/${input.canonicalPlayerId}`).get()).data(),
    ).toMatchObject({
      displayName: "Nombre verificado",
      identityProvenance: "operator_verified",
      photoUrl: "https://media.api-sports.io/football/players/2001.png",
    });
    await expect(
      service.preview({
        ...input,
        firstPlayerId: providerPlayerId,
        secondPlayerId: input.canonicalPlayerId,
        canonicalPlayerId: providerPlayerId,
        decision: "nonmatch",
      }),
    ).resolves.toMatchObject({
      status: "already_linked",
      canApply: false,
    });
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
            `playerProviderAliases/${playerProviderAliasId("api-football", externalIdFor(input))}`,
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

  it("links partial provider metadata when stable identity evidence exists", async () => {
    const input = identityInput("late");
    await seedIdentityScenario(input, {
      participant: true,
    });
    const token = await seedChallenge(input, "late");

    await service.applyAuthorized(input, token);

    expect(
      (
        await database
          .doc(
            `playerProviderAliases/${playerProviderAliasId("api-football", externalIdFor(input))}`,
          )
          .get()
      ).data(),
    ).toMatchObject({ canonicalPlayerId: input.canonicalPlayerId });
    expect(
      (await database.doc(`players/${input.canonicalPlayerId}`).get()).data(),
    ).toMatchObject({
      displayName: "Nombre verificado",
      externalProviderId: externalIdFor(input),
    });
  });

  it("rejects a provider alias already reviewed for another canonical Player", async () => {
    const input = identityInput("conflict");
    await seedIdentityScenario(input);
    await database
      .doc(
        `playerProviderAliases/${playerProviderAliasId("api-football", externalIdFor(input))}`,
      )
      .set({
        canonicalPlayerId: `player-internal-${"f".repeat(32)}`,
        canonicalExternalProviderPlayerId: externalIdFor(input),
        externalProvider: "api-football",
        externalProviderPlayerId: externalIdFor(input),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

    await expect(service.preview(input)).resolves.toMatchObject({
      status: "insufficient_evidence",
      canApply: false,
    });
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
    const providerPlayerId = await seedIdentityScenario(input, {
      providerPhotoUrl: "https://media.api-sports.io/football/players/3001.png",
    });
    const resultReference = database.doc(
      "matches/result-protected/results/summary",
    );
    await resultReference.set({
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
    const protectedReferences = [
      database.doc(`players/${input.canonicalPlayerId}`),
      database.doc(`players/${providerPlayerId}`),
      resultReference,
    ];
    const protectedBefore = await database.getAll(...protectedReferences);

    await expect(service.preview(input)).resolves.toMatchObject({
      status: "history_conflict",
      canApply: false,
      suggestedCanonicalPlayerId: providerPlayerId,
    });
    const token = await seedChallenge(input, "protected");
    await expect(service.applyAuthorized(input, token)).rejects.toBeInstanceOf(
      AdminPlayerIdentityRejectedError,
    );
    expect(
      (
        await database
          .doc(
            `playerProviderAliases/${playerProviderAliasId("api-football", externalIdFor(input))}`,
          )
          .get()
      ).exists,
    ).toBe(false);
    const protectedAfter = await database.getAll(...protectedReferences);
    expect(protectedAfter.map((snapshot) => snapshot.data())).toEqual(
      protectedBefore.map((snapshot) => snapshot.data()),
    );
  });

  it("preserves an active voting window and submitted ballot", async () => {
    const input = identityInput("voting");
    const providerPlayerId = await seedIdentityScenario(input, {
      participant: true,
    });
    const matchId = "match-voting";
    await database.doc(`matches/${matchId}`).update({
      ratingState: "rating_ready",
      ratingOpenedAt: Timestamp.now(),
      ratingClosesAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    const ballotReference = database.doc(
      `matches/${matchId}/ballots/voter-protected`,
    );
    await ballotReference.set({
      matchId,
      teamId: input.trackedTeamId,
      voterId: "voter-protected",
      playerRatings: { [providerPlayerId]: 8 },
      coachRating: { coachId: "coach-1", rating: 8 },
      submittedAt: Timestamp.now(),
    });
    const matchBefore = (await database.doc(`matches/${matchId}`).get()).data();
    const ballotBefore = (await ballotReference.get()).data();

    await expect(service.preview(input)).resolves.toMatchObject({
      status: "history_conflict",
      canApply: false,
      suggestedCanonicalPlayerId: providerPlayerId,
    });
    const token = await seedChallenge(input, "voting");
    await expect(service.applyAuthorized(input, token)).rejects.toBeInstanceOf(
      AdminPlayerIdentityRejectedError,
    );

    expect((await database.doc(`matches/${matchId}`).get()).data()).toEqual(
      matchBefore,
    );
    expect((await ballotReference.get()).data()).toEqual(ballotBefore);
  });

  it("suggests accent-insensitive and abbreviated duplicate names", async () => {
    const teamId = "team-suggestions";
    const manualId = `player-internal-${"a".repeat(32)}`;
    const providerId = providerEntityId("player", "api-football", "880001");
    await seedSuggestionIndex(teamId, [
      {
        id: manualId,
        name: "Jos\u00e9 Gonz\u00e1lez",
        provenance: "operator_verified",
        position: "midfielder",
        shirtNumber: 8,
      },
      {
        id: providerId,
        name: "J. Gonzalez",
        provenance: "provider",
        externalId: "880001",
        position: "midfielder",
        shirtNumber: 8,
      },
    ]);

    await expect(service.suggestions(teamId)).resolves.toMatchObject({
      providerDataAvailable: true,
      suggestions: [
        {
          first: { id: manualId, name: "Jos\u00e9 Gonz\u00e1lez" },
          second: { id: providerId, name: "J. Gonzalez" },
          suggestedCanonicalPlayerId: manualId,
          signals: ["abbreviation", "position", "shirt"],
        },
      ],
    });
  });

  it("reports provider unavailability without hiding manual reconciliation", async () => {
    const teamId = "team-no-provider";
    await seedSuggestionIndex(teamId, [
      {
        id: `player-internal-${"b".repeat(32)}`,
        name: "Jugador manual",
        provenance: "operator_verified",
      },
    ]);

    await expect(service.suggestions(teamId)).resolves.toEqual({
      providerDataAvailable: false,
      suggestions: [],
    });
  });

  it("compares two internal Players but blocks a merge without provider identity", async () => {
    const input = identityInput("internal-pair");
    input.secondPlayerId = `player-internal-${"c".repeat(32)}`;
    await database.doc(`players/${input.firstPlayerId}`).set({
      displayName: "Jugador interno uno",
      identityProvenance: "operator_verified",
      currentTeamId: input.trackedTeamId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await database.doc(`players/${input.secondPlayerId}`).set({
      displayName: "Jugador interno dos",
      identityProvenance: "operator_verified",
      currentTeamId: input.trackedTeamId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    await expect(service.preview(input)).resolves.toMatchObject({
      status: "insufficient_evidence",
      canApply: false,
    });
  });

  it("removes a pair from suggestions after the owner confirms they differ", async () => {
    const input = {
      ...identityInput("reviewed"),
      decision: "nonmatch" as const,
    };
    const providerPlayerId = await seedIdentityScenario(input);
    await database.doc(`players/${providerPlayerId}`).update({
      displayName: "Nombre verificado",
    });
    await seedMembershipIndex(input.trackedTeamId, [
      input.canonicalPlayerId,
      providerPlayerId,
    ]);
    expect(
      (await service.suggestions(input.trackedTeamId)).suggestions,
    ).toHaveLength(1);

    const token = await seedChallenge(input, "reviewed");
    await service.applyAuthorized(input, token);

    expect(
      (await service.suggestions(input.trackedTeamId)).suggestions,
    ).toEqual([]);
  });

  it("rejects selecting the same Player twice", async () => {
    const input = identityInput("same-player");
    input.secondPlayerId = input.firstPlayerId;

    await expect(service.preview(input)).rejects.toThrow(
      "Seleccione dos jugadores diferentes.",
    );
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
  const canonicalPlayerId = `player-internal-${createHash("md5").update(seed).digest("hex")}`;
  const providerPlayerId = providerEntityId(
    "player",
    "api-football",
    numericId,
  );
  return {
    firstPlayerId: canonicalPlayerId,
    secondPlayerId: providerPlayerId,
    canonicalPlayerId,
    trackedTeamId: `team-${seed}`,
    decision: "match",
    operatorId: `owner-${seed}`,
  };
}

function externalIdFor(input: AdminPlayerIdentityInput): string {
  const seed = input.trackedTeamId.replace(/^team-/, "");
  return String(
    700_000 +
      [...seed].reduce(
        (total, character) => total + character.charCodeAt(0),
        0,
      ),
  );
}

async function seedIdentityScenario(
  input: AdminPlayerIdentityInput,
  options: {
    participant?: boolean;
    draft?: boolean;
    verifiedLineup?: boolean;
    providerDocument?: boolean;
    canonicalPhotoUrl?: string;
    providerPhotoUrl?: string;
  } = {},
): Promise<string> {
  const providerPlayerId = providerEntityId(
    "player",
    "api-football",
    externalIdFor(input),
  );
  const timestamp = Timestamp.fromDate(new Date("2026-10-18T12:00:00.000Z"));
  await database.doc(`players/${input.canonicalPlayerId}`).set({
    displayName: "Nombre verificado",
    identityProvenance: "operator_verified",
    currentTeamId: input.trackedTeamId,
    ...(options.canonicalPhotoUrl
      ? { photoUrl: options.canonicalPhotoUrl }
      : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (options.providerDocument !== false) {
    await database.doc(`players/${providerPlayerId}`).set({
      displayName: "Nombre proveedor",
      identityProvenance: "provider",
      currentTeamId: input.trackedTeamId,
      externalProvider: "api-football",
      externalProviderId: externalIdFor(input),
      ...(options.providerPhotoUrl
        ? { photoUrl: options.providerPhotoUrl }
        : {}),
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
        externalProvider: "api-football",
        externalProviderTeamId: "815",
        externalProviderPlayerId: externalIdFor(input),
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

async function seedSuggestionIndex(
  teamId: string,
  players: Array<{
    id: string;
    name: string;
    provenance: "provider" | "operator_verified";
    externalId?: string;
    position?: "goalkeeper" | "defender" | "midfielder" | "attacker";
    shirtNumber?: number;
  }>,
): Promise<void> {
  const timestamp = Timestamp.fromDate(new Date("2026-10-18T12:00:00.000Z"));
  await database.doc(`teams/${teamId}/playerMembershipIndex/state`).set({
    teamId,
    status: "complete",
    schemaVersion: 1,
    baselineMembershipCount: players.length,
    blockingIssueCount: 0,
    auditedAt: timestamp,
  });
  await Promise.all(
    players.flatMap((player) => [
      database.doc(`players/${player.id}`).set({
        displayName: player.name,
        identityProvenance: player.provenance,
        currentTeamId: teamId,
        ...(player.externalId
          ? {
              externalProvider: "api-football",
              externalProviderId: player.externalId,
            }
          : {}),
        ...(player.position ? { position: player.position } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      database.doc(`teams/${teamId}/playerMemberships/${player.id}`).set({
        teamId,
        displayName: player.name,
        searchName: player.name.toLocaleLowerCase("es"),
        searchPrefixes: [player.name.slice(0, 1).toLocaleLowerCase("es")],
        source:
          player.provenance === "provider"
            ? "current_squad"
            : "operator_verified",
        ...(player.shirtNumber === undefined
          ? {}
          : { shirtNumber: player.shirtNumber }),
        firstObservedAt: timestamp,
        lastObservedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ]),
  );
}

async function seedMembershipIndex(
  teamId: string,
  playerIds: string[],
): Promise<void> {
  const snapshots = await database.getAll(
    ...playerIds.map((playerId) => database.doc(`players/${playerId}`)),
  );
  await seedSuggestionIndex(
    teamId,
    snapshots.map((snapshot) => {
      const player = snapshot.data()!;
      return {
        id: snapshot.id,
        name: String(player.displayName),
        provenance: player.identityProvenance as
          "provider" | "operator_verified",
        ...(player.externalProviderId
          ? { externalId: String(player.externalProviderId) }
          : {}),
      };
    }),
  );
}
