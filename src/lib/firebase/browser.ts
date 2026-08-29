import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { firebaseEnvironment, isFirebaseConfigured } from "./config";

export function getBrowserFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) throw new Error("Firebase browser configuration is missing. See .env.example.");
  return getApps()[0] ?? initializeApp(firebaseEnvironment);
}
export function getExistingBrowserFirebaseApp(): FirebaseApp | null { return getApps().length > 0 ? getApp() : null; }
