import { pathToFileURL } from "node:url";

import initialTeam from "../firebase/seed/initial-team.json" with { type: "json" };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function parseEmulatorHost(value) {
  if (!value) throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  const separator = value.lastIndexOf(":");
  if (separator < 1)
    throw new Error("FIRESTORE_EMULATOR_HOST must include a port.");
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  if (!LOCAL_HOSTS.has(host) || !Number.isInteger(port)) {
    throw new Error(
      "Development seeding is restricted to a local Firestore emulator.",
    );
  }
  return { host, port };
}

function stringValue(value) {
  return { stringValue: value };
}

export async function ensureDevelopmentTeam({
  emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080",
  projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local",
} = {}) {
  if (!projectId.startsWith("demo-")) {
    throw new Error(
      "Development seeding requires a demo-* Firebase project ID.",
    );
  }
  const { host, port } = parseEmulatorHost(emulatorHost);
  const baseUrl = `http://${host}:${port}/v1/projects/${projectId}/databases/(default)/documents`;
  const existing = await fetch(`${baseUrl}/teams/${initialTeam.id}`, {
    headers: { Authorization: "Bearer owner" },
  });

  if (existing.ok) return { created: false, teamId: initialTeam.id };
  if (existing.status !== 404) {
    throw new Error(`Could not inspect Team document (${existing.status}).`);
  }

  const now = new Date().toISOString();
  const created = await fetch(`${baseUrl}/teams?documentId=${initialTeam.id}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        displayName: stringValue(initialTeam.displayName),
        shortName: stringValue(initialTeam.shortName),
        countryCode: stringValue(initialTeam.countryCode),
        brandingKey: stringValue(initialTeam.brandingKey),
        createdAt: { timestampValue: now },
        updatedAt: { timestampValue: now },
      },
    }),
  });
  if (!created.ok) {
    throw new Error(`Could not create Team document (${created.status}).`);
  }
  return { created: true, teamId: initialTeam.id };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await ensureDevelopmentTeam();
  console.log(
    result.created
      ? `Created teams/${result.teamId}.`
      : `teams/${result.teamId} already exists; no changes made.`,
  );
}
