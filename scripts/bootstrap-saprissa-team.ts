import { pathToFileURL } from "node:url";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";
import saprissaTeam from "../firebase/seed/saprissa-team.json";
import { bootstrapSaprissaTeam } from "./lib/bootstrap-club-team";
import { verifyProviderTeam } from "./verify-provider-team";

export interface SaprissaBootstrapArguments {
  projectId: string;
  providerTeamId: string;
  apply: boolean;
}

export function parseSaprissaBootstrapArguments(
  arguments_: readonly string[],
): SaprissaBootstrapArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) throw usageError();
    values.set(key, value);
  }
  const projectId = values.get("--project-id");
  const providerTeamId = values.get("--provider-team-id");
  const apply = values.get("--apply") === "true";
  if (
    !projectId ||
    projectId.startsWith("demo-") ||
    !providerTeamId ||
    !/^[1-9]\d*$/.test(providerTeamId) ||
    [...values.keys()].some(
      (key) =>
        ![
          "--project-id",
          "--provider-team-id",
          "--apply",
          "--confirm",
        ].includes(key),
    ) ||
    (values.has("--apply") && values.get("--apply") !== "true") ||
    (apply &&
      values.get("--confirm") !== `bootstrap-saprissa-team:${projectId}`) ||
    (!apply && values.has("--confirm"))
  ) {
    throw usageError();
  }
  return { projectId, providerTeamId, apply };
}

export async function main() {
  const arguments_ = parseSaprissaBootstrapArguments(process.argv.slice(2));
  const config = readFirebaseAdminRuntimeConfig();
  if (config.environment !== "production" || config.emulator) {
    throw new Error(
      "Saprissa bootstrap requires production without emulators.",
    );
  }
  if (config.projectId !== arguments_.projectId) {
    throw new Error("The confirmed project ID does not match Firebase Admin.");
  }
  const verified = await verifyProviderTeam(
    "saprissa",
    process.env.API_FOOTBALL_KEY ?? "",
  );
  if (verified.externalProviderId !== arguments_.providerTeamId) {
    throw new Error("Provider Team identity differs from the confirmed ID.");
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
    `saprissa-team-bootstrap-${Date.now()}`,
  );
  try {
    const outcome = await bootstrapSaprissaTeam(
      getFirestore(app),
      arguments_.providerTeamId,
      arguments_.apply,
    );
    console.log(
      JSON.stringify({
        mode: arguments_.apply ? "apply" : "dry-run",
        projectId: arguments_.projectId,
        teamId: saprissaTeam.id,
        providerTeamId: verified.externalProviderId,
        providerRequests: verified.providerRequests,
        outcome,
        writes: arguments_.apply && outcome !== "unchanged" ? 1 : 0,
      }),
    );
  } finally {
    await deleteApp(app);
  }
}

function usageError() {
  return new Error(
    "Usage: npm run bootstrap:saprissa-team -- --project-id <production-project> --provider-team-id <verified-id> [--apply true --confirm bootstrap-saprissa-team:<production-project>]",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch(() => {
    console.error("Saprissa Team bootstrap failed.");
    process.exitCode = 1;
  });
}
