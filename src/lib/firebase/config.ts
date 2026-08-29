export type FirebaseEnvironmentName = "local" | "development" | "production";

const environmentName = process.env.NEXT_PUBLIC_FIREBASE_ENVIRONMENT;

export const firebaseEnvironmentName: FirebaseEnvironmentName | null =
  environmentName === "local" ||
  environmentName === "development" ||
  environmentName === "production"
    ? environmentName
    : null;

export const firebaseEnvironment = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firestoreEmulator = {
  host: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? "127.0.0.1",
  port: Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? "8080"),
};

export const authEmulator = {
  host: process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST ?? "127.0.0.1",
  port: Number(process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? "9099"),
};

export const isFirebaseConfigured =
  firebaseEnvironmentName === "local" ||
  (firebaseEnvironmentName !== null &&
    Object.values(firebaseEnvironment).every(Boolean));
