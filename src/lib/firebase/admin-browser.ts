import { getApp, getApps, initializeApp } from "firebase/app";
import {
  inMemoryPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";

import {
  authEmulator,
  firebaseEnvironment,
  firebaseEnvironmentName,
  isFirebaseConfigured,
  isFirebaseEnvironmentSafe,
} from "./config";

const APP_NAME = "rating-admin";
let authPromise: Promise<Auth> | undefined;
let emulatorConnected = false;

export function getAdminBrowserAuth(): Promise<Auth> {
  authPromise ??= initializeAdminAuth();
  return authPromise;
}

async function initializeAdminAuth(): Promise<Auth> {
  if (!isFirebaseConfigured || !isFirebaseEnvironmentSafe) {
    throw new Error("Firebase configuration is unavailable.");
  }
  const projectId = firebaseEnvironment.projectId || "demo-rating-app-local";
  const options =
    firebaseEnvironmentName === "local"
      ? {
          apiKey: firebaseEnvironment.apiKey || "demo-api-key",
          authDomain:
            firebaseEnvironment.authDomain || `${projectId}.firebaseapp.com`,
          projectId,
        }
      : firebaseEnvironment;
  const app = getApps().some((value) => value.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(options, APP_NAME);
  const auth = getAuth(app);
  if (firebaseEnvironmentName === "local" && !emulatorConnected) {
    connectAuthEmulator(
      auth,
      `http://${authEmulator.host}:${authEmulator.port}`,
      { disableWarnings: true },
    );
    emulatorConnected = true;
  }
  await setPersistence(auth, inMemoryPersistence);
  return auth;
}
