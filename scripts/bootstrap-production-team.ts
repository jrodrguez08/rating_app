import { pathToFileURL } from "node:url";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import initialTeam from "../firebase/seed/initial-team.json";
import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";

const CONFIRMATION = "bootstrap-production-team";

export interface ProductionBootstrapArguments {
  projectId: string;
  providerTeamId: string;
}

export function parseProductionBootstrapArguments(
  arguments_: readonly string[],
): ProductionBootstrapArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value) throw usageError();
    values.set(key, value);
  }
  const projectId = values.get("--project-id");
  const providerTeamId = values.get("--provider-team-id");
  if (
    !projectId ||
    !providerTeamId ||
    !/^\d+$/.test(providerTeamId) ||
    values.get("--confirm") !== CONFIRMATION ||
    values.size !== 3
  ) {
    throw usageError();
  }
  if (projectId.startsWith("demo-")) {
    throw new Error("Production bootstrap rejects demo-* projects.");
  }
  return { projectId, providerTeamId };
}

async function main() {
  const arguments_ = parseProductionBootstrapArguments(process.argv.slice(2));
  const config = readFirebaseAdminRuntimeConfig();
  if (config.environment !== "production" || config.emulator) {
    throw new Error(
      "Team bootstrap requires production mode without emulators.",
    );
  }
  if (config.projectId !== arguments_.projectId) {
    throw new Error("The confirmed project ID does not match Firebase Admin.");
  }
  const app = initializeApp(
    {
      projectId: config.projectId,
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail!,
        privateKey: config.privateKey!,
      }),
    },
    `production-team-bootstrap-${Date.now()}`,
  );
  try {
    const database = getFirestore(app);
    const reference = database.doc(`teams/${initialTeam.id}`);
    const outcome = await database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        const existing = snapshot.data();
        if (
          existing?.displayName !== initialTeam.displayName ||
          (existing.externalProviderId !== undefined &&
            existing.externalProviderId !== arguments_.providerTeamId)
        ) {
          throw new Error("Existing canonical Team identity does not match.");
        }
        if (existing.externalProviderId === arguments_.providerTeamId) {
          return "unchanged" as const;
        }
        transaction.update(reference, {
          externalProviderId: arguments_.providerTeamId,
          updatedAt: Timestamp.now(),
        });
        return "mapped" as const;
      }
      const now = Timestamp.now();
      transaction.create(reference, {
        displayName: initialTeam.displayName,
        shortName: initialTeam.shortName,
        countryName: initialTeam.countryName,
        countryCode: initialTeam.countryCode,
        brandingKey: initialTeam.brandingKey,
        externalProviderId: arguments_.providerTeamId,
        createdAt: now,
        updatedAt: now,
      });
      return "created" as const;
    });
    console.log(
      `Production Team bootstrap ${outcome}: teams/${initialTeam.id}.`,
    );
  } finally {
    await deleteApp(app);
  }
}

function usageError() {
  return new Error(
    "Usage: npm run bootstrap:production-team -- --project-id <project> --provider-team-id <id> --confirm bootstrap-production-team",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
