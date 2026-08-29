import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInAnonymously,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
} from "firebase/firestore";
import { afterEach, describe, expect, it } from "vitest";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const apps = new Set<ReturnType<typeof initializeApp>>();

afterEach(async () => {
  await Promise.all(
    [...apps].map(async (app) => {
      const auth = getAuth(app);
      if (auth.currentUser !== null) await auth.currentUser.delete();
      await deleteApp(app);
    }),
  );
  apps.clear();
});

describe("anonymous voter identity", () => {
  it("creates and reuses one UID while protected Firestore stays denied", async () => {
    const authHost = requiredHost("FIREBASE_AUTH_EMULATOR_HOST");
    const firestoreHost = requiredHost("FIRESTORE_EMULATOR_HOST");
    const app = initializeApp(
      {
        apiKey: "demo-api-key",
        authDomain: `${projectId}.firebaseapp.com`,
        projectId,
      },
      `anonymous-voter-${Date.now()}`,
    );
    apps.add(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${authHost.host}:${authHost.port}`, {
      disableWarnings: true,
    });
    await setPersistence(auth, inMemoryPersistence);

    const credential = await signInAnonymously(auth);
    expect(credential.user.isAnonymous).toBe(true);
    expect(credential.user.uid).toBeTruthy();
    expect(auth.currentUser?.uid).toBe(credential.user.uid);

    const database = getFirestore(app);
    connectFirestoreEmulator(database, firestoreHost.host, firestoreHost.port);
    await expect(
      setDoc(doc(database, "matches/example"), {
        ratingState: "rating_ready",
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("keeps an uninitialized session distinguishable from a voter", () => {
    const app = initializeApp(
      { apiKey: "demo-api-key", projectId },
      `unauthenticated-${Date.now()}`,
    );
    apps.add(app);
    expect(getAuth(app).currentUser).toBeNull();
  });
});

function requiredHost(name: string): { host: string; port: number } {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is required.`);
  const separator = value.lastIndexOf(":");
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  if (host === "" || !Number.isInteger(port)) {
    throw new Error(`${name} is invalid.`);
  }
  return { host, port };
}
