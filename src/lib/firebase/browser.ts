import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

import {
  authEmulator,
  firebaseEnvironment,
  firebaseEnvironmentName,
  firestoreEmulator,
  isFirebaseConfigured,
} from "./config";

const LOCAL_PROJECT_ID = "demo-rating-app-local";
const emulatorConnections = globalThis as typeof globalThis & {
  __ratingAppAuthEmulators?: Set<string>;
  __ratingAppFirestoreEmulators?: Set<string>;
};

export function getBrowserFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error(
      "Firebase environment configuration is missing or invalid. See .env.example.",
    );
  }

  const localProjectId = firebaseEnvironment.projectId || LOCAL_PROJECT_ID;
  const options =
    firebaseEnvironmentName === "local"
      ? {
          apiKey: firebaseEnvironment.apiKey || "demo-api-key",
          authDomain:
            firebaseEnvironment.authDomain ||
            `${localProjectId}.firebaseapp.com`,
          projectId: localProjectId,
        }
      : firebaseEnvironment;

  return getApps()[0] ?? initializeApp(options);
}

export function getBrowserFirestore(): Firestore {
  const app = getBrowserFirebaseApp();
  const database = getFirestore(app);

  if (firebaseEnvironmentName === "local") {
    if (!Number.isInteger(firestoreEmulator.port)) {
      throw new Error("Firestore emulator port must be an integer.");
    }
    const connections = (emulatorConnections.__ratingAppFirestoreEmulators ??=
      new Set<string>());
    if (!connections.has(app.name)) {
      connectFirestoreEmulator(
        database,
        firestoreEmulator.host,
        firestoreEmulator.port,
      );
      connections.add(app.name);
    }
  }

  return database;
}

export function getBrowserAuth(): Auth {
  const app = getBrowserFirebaseApp();
  const auth = getAuth(app);

  if (firebaseEnvironmentName === "local") {
    if (!Number.isInteger(authEmulator.port)) {
      throw new Error("Auth emulator port must be an integer.");
    }
    const connections = (emulatorConnections.__ratingAppAuthEmulators ??=
      new Set<string>());
    if (!connections.has(app.name)) {
      connectAuthEmulator(
        auth,
        `http://${authEmulator.host}:${authEmulator.port}`,
        { disableWarnings: true },
      );
      connections.add(app.name);
    }
  }

  return auth;
}

export function getExistingBrowserFirebaseApp(): FirebaseApp | null {
  return getApps().length > 0 ? getApp() : null;
}
