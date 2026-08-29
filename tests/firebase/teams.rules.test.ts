import { readFileSync } from "node:fs";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getTeamById } from "@/lib/firebase/teams";

import { ensureDevelopmentTeam } from "../../scripts/seed-development.mjs";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
let environment: RulesTestEnvironment;
let emulatorHost: string;
let emulatorPort: number;

beforeAll(async () => {
  const hostAndPort = process.env.FIRESTORE_EMULATOR_HOST;
  if (!hostAndPort) throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  const [host, port] = hostAndPort.split(":");
  if (!host || !port) throw new Error("Invalid FIRESTORE_EMULATOR_HOST.");
  emulatorHost = host;
  emulatorPort = Number(port);
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: emulatorHost,
      port: emulatorPort,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});

beforeEach(async () => environment.clearFirestore());
afterAll(async () => environment.cleanup());

describe("Team persistence and rules", () => {
  it("seeds the deterministic initial Team idempotently", async () => {
    const first = await ensureDevelopmentTeam({
      emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
      projectId,
    });
    let firstData: unknown;
    await environment.withSecurityRulesDisabled(async (context) => {
      firstData = (
        await context.firestore().doc(`teams/${first.teamId}`).get()
      ).data();
    });

    const second = await ensureDevelopmentTeam({
      emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
      projectId,
    });
    let secondData: unknown;
    await environment.withSecurityRulesDisabled(async (context) => {
      secondData = (
        await context.firestore().doc(`teams/${second.teamId}`).get()
      ).data();
    });

    expect(first).toEqual({ created: true, teamId: "club-sport-herediano" });
    expect(second).toEqual({ created: false, teamId: first.teamId });
    expect(secondData).toEqual(firstData);
  });

  it("allows public Team reads through the typed persistence boundary", async () => {
    await ensureDevelopmentTeam({
      emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
      projectId,
    });
    const app = initializeApp({ projectId }, `public-reader-${Date.now()}`);
    const database = getFirestore(app);
    connectFirestoreEmulator(database, emulatorHost, emulatorPort);
    const team = await getTeamById(database, "club-sport-herediano");
    await deleteApp(app);

    expect(team).toMatchObject({
      id: "club-sport-herediano",
      displayName: "Club Sport Herediano",
      shortName: "Herediano",
      countryName: "Costa Rica",
      countryCode: "CR",
      brandingKey: "herediano",
    });
  });

  it("rejects arbitrary Team writes from unauthenticated and authenticated clients", async () => {
    const unauthenticated = environment.unauthenticatedContext().firestore();
    const authenticated = environment
      .authenticatedContext("supporter-1")
      .firestore();
    const arbitraryTeam = { displayName: "Arbitrary Team" };

    await assertFails(
      unauthenticated.doc("teams/arbitrary").set(arbitraryTeam),
    );
    await assertFails(authenticated.doc("teams/arbitrary").set(arbitraryTeam));
  });

  it("rejects Team deletion while allowing an intentional public read", async () => {
    await ensureDevelopmentTeam({
      emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
      projectId,
    });
    const reference = environment
      .unauthenticatedContext()
      .firestore()
      .doc("teams/club-sport-herediano");
    const authenticatedReference = environment
      .authenticatedContext("supporter-1")
      .firestore()
      .doc("teams/club-sport-herediano");

    await assertSucceeds(reference.get());
    await assertFails(
      authenticatedReference.set({ displayName: "Changed" }, { merge: true }),
    );
    await assertFails(reference.delete());
  });

  it.each(["competitions", "seasons", "matches"])(
    "keeps %s client reads and writes denied until a browsing feature needs them",
    async (collection) => {
      const database = environment.unauthenticatedContext().firestore();
      const reference = database.doc(`${collection}/example`);

      await assertFails(reference.get());
      await assertFails(reference.set({ name: "Not allowed" }));
    },
  );
});
