import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminFootballSyncStore } from "@/lib/firebase/server";

import { bootstrapSaprissaTeam } from "../../scripts/lib/bootstrap-club-team";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `saprissa-bootstrap-${Date.now()}`);
const database = getFirestore(app);
let originalSaprissa: DocumentData | undefined;
let originalHerediano: DocumentData | undefined;
let originalSaprissaMetadata: DocumentData | undefined;
let originalHeredianoMetadata: DocumentData | undefined;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }
  originalSaprissa = (
    await database.doc("teams/deportivo-saprissa").get()
  ).data();
  originalHerediano = (
    await database.doc("teams/club-sport-herediano").get()
  ).data();
  originalSaprissaMetadata = (
    await database.doc("footballSyncMetadata/deportivo-saprissa").get()
  ).data();
  originalHeredianoMetadata = (
    await database.doc("footballSyncMetadata/club-sport-herediano").get()
  ).data();
  await database.doc("teams/deportivo-saprissa").delete();
});

afterAll(async () => {
  for (const [path, data] of [
    ["teams/deportivo-saprissa", originalSaprissa],
    ["teams/club-sport-herediano", originalHerediano],
    ["footballSyncMetadata/deportivo-saprissa", originalSaprissaMetadata],
    ["footballSyncMetadata/club-sport-herediano", originalHeredianoMetadata],
  ] as const) {
    if (data === undefined) await database.doc(path).delete();
    else await database.doc(path).set(data);
  }
  await deleteApp(app);
});

describe("explicit Saprissa Team bootstrap", () => {
  it("plans, creates once, validates replay, and preserves Herediano", async () => {
    const herediano = {
      displayName: "Club Sport Herediano",
      externalProviderId: "815",
    };
    await database.doc("teams/club-sport-herediano").set(herediano);
    expect(await bootstrapSaprissaTeam(database, "816", false)).toBe("create");
    expect((await database.doc("teams/deportivo-saprissa").get()).exists).toBe(
      false,
    );
    expect(await bootstrapSaprissaTeam(database, "816", true)).toBe("create");
    expect(await bootstrapSaprissaTeam(database, "816", true)).toBe(
      "unchanged",
    );
    expect(
      (await database.doc("teams/deportivo-saprissa").get()).data(),
    ).toMatchObject({
      displayName: "Deportivo Saprissa",
      countryName: "Costa Rica",
      externalProviderId: "816",
    });
    expect(
      (await database.doc("teams/club-sport-herediano").get()).data(),
    ).toEqual(herediano);
  });

  it("adds only a missing mapping to compatible Team data", async () => {
    const reference = database.doc("teams/deportivo-saprissa");
    const existing = (await reference.get()).data()!;
    const withoutMapping = { ...existing };
    delete withoutMapping.externalProviderId;
    await reference.set(withoutMapping);
    expect(await bootstrapSaprissaTeam(database, "816", false)).toBe("map");
    expect((await reference.get()).data()).not.toHaveProperty(
      "externalProviderId",
    );
    expect(await bootstrapSaprissaTeam(database, "816", true)).toBe("map");
    expect((await reference.get()).data()?.externalProviderId).toBe("816");
  });

  it("rejects conflicting canonical fields, mapping, and another Team's provider ID", async () => {
    const reference = database.doc("teams/deportivo-saprissa");
    const canonical = (await reference.get()).data()!;
    await reference.update({ displayName: "Different Team" });
    await expect(bootstrapSaprissaTeam(database, "816", true)).rejects.toThrow(
      "conflicts",
    );
    await reference.set(canonical);
    await expect(bootstrapSaprissaTeam(database, "999", true)).rejects.toThrow(
      "conflicts",
    );
    await database.doc("teams/other-team").set({ externalProviderId: "816" });
    await expect(bootstrapSaprissaTeam(database, "816", true)).rejects.toThrow(
      "another canonical Team",
    );
    expect((await reference.get()).data()).toEqual(canonical);
  });

  it("uses independent execution leases and request outcomes for the two clubs", async () => {
    const herediano = new AdminFootballSyncStore(database);
    const saprissa = new AdminFootballSyncStore(database);
    expect(
      await herediano.claimLifecycleExecution(
        "club-sport-herediano",
        "h-1",
        "scheduled",
      ),
    ).toMatchObject({ status: "claimed" });
    expect(
      await saprissa.claimLifecycleExecution(
        "deportivo-saprissa",
        "s-1",
        "scheduled",
      ),
    ).toMatchObject({ status: "claimed" });
    expect(
      await herediano.claimLifecycleExecution(
        "club-sport-herediano",
        "h-2",
        "operator",
      ),
    ).toMatchObject({ status: "busy" });
    await herediano.completeLifecycleExecution("club-sport-herediano", "h-1", {
      action: "retryable_error",
      providerRequests: 3,
    });
    await saprissa.completeLifecycleExecution("deportivo-saprissa", "s-1", {
      action: "discovered",
      providerRequests: 2,
    });
    expect(
      (
        await database.doc("footballSyncMetadata/club-sport-herediano").get()
      ).data(),
    ).toMatchObject({
      lastLifecycleAction: "retryable_error",
      lastLifecycleProviderRequests: 3,
    });
    expect(
      (
        await database.doc("footballSyncMetadata/deportivo-saprissa").get()
      ).data(),
    ).toMatchObject({
      lastLifecycleAction: "discovered",
      lastLifecycleProviderRequests: 2,
    });
  });
});
