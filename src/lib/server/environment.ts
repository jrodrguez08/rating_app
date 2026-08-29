export type RuntimeEnvironment = "local" | "development" | "production";

type Environment = Readonly<Record<string, string | undefined>>;

export interface FirebaseAdminRuntimeConfig {
  environment: RuntimeEnvironment;
  projectId: string;
  emulator: boolean;
  firestoreEmulatorHost?: string;
  authEmulatorHost?: string;
  clientEmail?: string;
  privateKey?: string;
}

const LOCAL_PROJECT_ID = "demo-rating-app-local";

export function readFirebaseAdminRuntimeConfig(
  environment: Environment = process.env,
): FirebaseAdminRuntimeConfig {
  const mode = runtimeEnvironment(environment);
  if (mode === "local") {
    const projectId = environment.FIREBASE_ADMIN_PROJECT_ID || LOCAL_PROJECT_ID;
    const webProjectId = environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (
      !projectId.startsWith("demo-") ||
      (webProjectId !== undefined &&
        webProjectId !== "" &&
        (webProjectId !== projectId || !webProjectId.startsWith("demo-")))
    ) {
      throw new Error("Local Firebase Admin requires a demo-* project ID.");
    }
    return {
      environment: mode,
      projectId,
      emulator: true,
      firestoreEmulatorHost:
        environment.FIRESTORE_EMULATOR_HOST ||
        `${environment.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST || "127.0.0.1"}:${validPort(environment.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT, "8080")}`,
      authEmulatorHost:
        environment.FIREBASE_AUTH_EMULATOR_HOST ||
        `${environment.NEXT_PUBLIC_AUTH_EMULATOR_HOST || "127.0.0.1"}:${validPort(environment.NEXT_PUBLIC_AUTH_EMULATOR_PORT, "9099")}`,
    };
  }

  if (
    environment.FIRESTORE_EMULATOR_HOST ||
    environment.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error("Hosted Firebase Admin must not use emulator hosts.");
  }
  const projectId = required(environment, "FIREBASE_ADMIN_PROJECT_ID");
  if (projectId.startsWith("demo-")) {
    throw new Error("Hosted Firebase Admin must not use a demo-* project ID.");
  }
  const webProjectId = required(environment, "NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (webProjectId !== projectId) {
    throw new Error("Firebase Web and Admin project IDs must match.");
  }
  const clientEmail = required(environment, "FIREBASE_ADMIN_CLIENT_EMAIL");
  const privateKey = required(
    environment,
    "FIREBASE_ADMIN_PRIVATE_KEY",
  ).replace(/\\n/g, "\n");
  if (
    !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
    !privateKey.includes("-----END PRIVATE KEY-----")
  ) {
    throw new Error("FIREBASE_ADMIN_PRIVATE_KEY is malformed.");
  }
  return {
    environment: mode,
    projectId,
    emulator: false,
    clientEmail,
    privateKey,
  };
}

export function requireLifecycleRuntimeConfig(
  environment: Environment = process.env,
) {
  const cronSecret = required(environment, "CRON_SECRET");
  const apiFootballKey = required(environment, "API_FOOTBALL_KEY");
  return {
    cronSecret,
    apiFootballKey,
    firebaseAdmin: readFirebaseAdminRuntimeConfig(environment),
  };
}

function runtimeEnvironment(environment: Environment): RuntimeEnvironment {
  const value = environment.NEXT_PUBLIC_FIREBASE_ENVIRONMENT;
  if (value === "local" || value === "development" || value === "production") {
    return value;
  }
  throw new Error("NEXT_PUBLIC_FIREBASE_ENVIRONMENT is missing or invalid.");
}

function required(environment: Environment, name: string) {
  const value = environment[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value;
}

function validPort(value: string | undefined, fallback: string) {
  const port = value || fallback;
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("Firebase emulator port is invalid.");
  }
  return port;
}
