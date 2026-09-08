import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PLAYER_IDENTITY_RECONCILIATIONS } from "@/config/player-identity-reconciliations";
import type { PlayerProviderAlias } from "@/domain/models";
import {
  playerProviderAliasId,
  providerEntityId,
} from "@/domain/player-identity";

import { applyPlan, loadPlan } from "../../scripts/reconcile-player-identities";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp(
  { projectId },
  `player-identity-reconciliation-${Date.now()}`,
);
const database = getFirestore(app);
const reconciliation = PLAYER_IDENTITY_RECONCILIATIONS[0];
const canonicalId = providerEntityId("player", "api-football", "36237");
const legacyId = providerEntityId("player", "api-football", "541314");
const canonicalAliasId = playerProviderAliasId("api-football", "36237");
const legacyAliasId = playerProviderAliasId("api-football", "541314");
const plannedAt = "2026-09-08T12:00:00.000Z";

beforeEach(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  await Promise.all([
    database.doc(`players/${canonicalId}`).delete(),
    database.doc(`players/${legacyId}`).delete(),
    database.doc(`playerProviderAliases/${canonicalAliasId}`).delete(),
    database.doc(`playerProviderAliases/${legacyAliasId}`).delete(),
  ]);
  await seedPlayers();
});

afterAll(() => deleteApp(app));

describe("player identity reconciliation transaction", () => {
  it("creates aliases that remain absent at apply time", async () => {
    const plan = await loadPlan(database, reconciliation, plannedAt);

    await expect(applyPlan(database, plan)).resolves.toEqual({
      canonicalPlayerUpdated: true,
      aliasWrites: 2,
      aliasIds: [canonicalAliasId, legacyAliasId],
    });
    await expect(readAlias(legacyAliasId)).resolves.toMatchObject({
      canonicalPlayerId: canonicalId,
      canonicalExternalProviderPlayerId: "36237",
    });
  });

  it("treats matching aliases as no-ops", async () => {
    await Promise.all([
      seedAlias(canonicalAliasId, "36237", canonicalId, "36237"),
      seedAlias(legacyAliasId, "541314", canonicalId, "36237"),
    ]);
    const plan = await loadPlan(database, reconciliation, plannedAt);

    expect(plan.aliasWrites).toEqual([]);
    await expect(applyPlan(database, plan)).resolves.toEqual({
      canonicalPlayerUpdated: true,
      aliasWrites: 0,
      aliasIds: [],
    });
  });

  it("reconciles only an expected self-alias and preserves its creation time", async () => {
    const createdAt = "2026-01-02T00:00:00.000Z";
    await Promise.all([
      seedAlias(canonicalAliasId, "36237", canonicalId, "36237"),
      seedAlias(legacyAliasId, "541314", legacyId, "541314", createdAt),
    ]);
    const plan = await loadPlan(database, reconciliation, plannedAt);

    await expect(applyPlan(database, plan)).resolves.toMatchObject({
      aliasWrites: 1,
    });
    await expect(readAlias(legacyAliasId)).resolves.toMatchObject({
      canonicalPlayerId: canonicalId,
      createdAt,
      updatedAt: plannedAt,
    });
  });

  it("aborts when a conflicting alias appears after planning", async () => {
    const plan = await loadPlan(database, reconciliation, plannedAt);
    await seedAlias(legacyAliasId, "541314", "different-player", "999");

    await expect(applyPlan(database, plan)).rejects.toThrow(/conflicts/i);
    await expect(
      database.doc(`playerProviderAliases/${canonicalAliasId}`).get(),
    ).resolves.toMatchObject({ exists: false });
    await expect(readPlayer()).resolves.not.toHaveProperty("position");
  });

  it("makes repeated application of the same plan an effective no-op", async () => {
    const plan = await loadPlan(database, reconciliation, plannedAt);

    await expect(applyPlan(database, plan)).resolves.toEqual({
      canonicalPlayerUpdated: true,
      aliasWrites: 2,
      aliasIds: [canonicalAliasId, legacyAliasId],
    });
    await expect(applyPlan(database, plan)).resolves.toEqual({
      canonicalPlayerUpdated: false,
      aliasWrites: 0,
      aliasIds: [],
    });
  });

  it("preserves concurrent canonical enrichment and fills only a still-missing field", async () => {
    await database.doc(`players/${legacyId}`).update({
      photoUrl: "https://media.api-sports.io/football/players/541314.png",
    });
    const plan = await loadPlan(database, reconciliation, plannedAt);
    await database.doc(`players/${canonicalId}`).update({
      position: "forward",
      updatedAt: Timestamp.fromDate(new Date("2026-09-08T12:01:00.000Z")),
    });

    await expect(applyPlan(database, plan)).resolves.toMatchObject({
      canonicalPlayerUpdated: true,
    });
    await expect(readPlayer()).resolves.toMatchObject({
      position: "forward",
      photoUrl: "https://media.api-sports.io/football/players/541314.png",
    });
  });

  it("never degrades usable canonical metadata", async () => {
    await database.doc(`players/${canonicalId}`).update({
      position: "defender",
      photoUrl: "https://media.api-sports.io/football/players/36237.png",
    });
    const plan = await loadPlan(database, reconciliation, plannedAt);

    expect(plan.canonicalPlayerWrite).toBeNull();
    await expect(applyPlan(database, plan)).resolves.toMatchObject({
      canonicalPlayerUpdated: false,
    });
    await expect(readPlayer()).resolves.toMatchObject({
      position: "defender",
      photoUrl: "https://media.api-sports.io/football/players/36237.png",
    });
  });
});

async function seedPlayers() {
  const timestamp = Timestamp.fromDate(new Date("2026-01-01T00:00:00.000Z"));
  await Promise.all([
    database.doc(`players/${canonicalId}`).set({
      displayName: "S. Rodriguez",
      externalProvider: "api-football",
      externalProviderId: "36237",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    database.doc(`players/${legacyId}`).set({
      displayName: "S. Rodriguez",
      position: "midfielder",
      externalProvider: "api-football",
      externalProviderId: "541314",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  ]);
}

async function seedAlias(
  id: string,
  externalProviderPlayerId: string,
  canonicalPlayerId: string,
  canonicalExternalProviderPlayerId: string,
  createdAt = "2026-01-01T00:00:00.000Z",
) {
  await database.doc(`playerProviderAliases/${id}`).set({
    canonicalPlayerId,
    canonicalExternalProviderPlayerId,
    externalProvider: "api-football",
    externalProviderPlayerId,
    createdAt: Timestamp.fromDate(new Date(createdAt)),
    updatedAt: Timestamp.fromDate(new Date(createdAt)),
  });
}

async function readAlias(id: string): Promise<PlayerProviderAlias> {
  const snapshot = await database.doc(`playerProviderAliases/${id}`).get();
  const value = snapshot.data()!;
  return {
    ...(value as Omit<PlayerProviderAlias, "id" | "createdAt" | "updatedAt">),
    id,
    createdAt: value.createdAt.toDate().toISOString(),
    updatedAt: value.updatedAt.toDate().toISOString(),
  };
}

async function readPlayer(): Promise<Record<string, unknown>> {
  return (await database.doc(`players/${canonicalId}`).get()).data() ?? {};
}
