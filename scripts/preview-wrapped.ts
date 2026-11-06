import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { Firestore } from "firebase-admin/firestore";

import { parseWrappedLedger } from "@/application/wrapped-ledger";

import { previewWrappedCoverage } from "./lib/wrapped-preview";

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      tournament: { type: "string" },
      "project-id": { type: "string" },
      "as-of": { type: "string" },
    },
  });
  const { input, tournament, "project-id": projectId, "as-of": time } = values;
  if (!input || !tournament || !projectId || !time)
    throw new Error(
      "Required options: --input, --tournament, --project-id, --as-of.",
    );
  const asOf = new Date(time);
  if (
    !Number.isFinite(asOf.getTime()) ||
    asOf.toISOString() !== time ||
    asOf.getTime() > Date.now()
  )
    throw new Error(
      "--as-of must be a UTC ISO timestamp at or before the current time.",
    );

  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const port = /^(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/.exec(
    host ?? "",
  )?.[1];
  if (
    !/^demo-[a-z0-9][a-z0-9-]{0,24}$/.test(projectId) ||
    !host ||
    !port ||
    Number(port) > 65535
  )
    throw new Error(
      "Wrapped preview requires a demo-* project and an explicit loopback Firestore emulator.",
    );
  if (
    [
      process.env.GCLOUD_PROJECT,
      process.env.GOOGLE_CLOUD_PROJECT,
      process.env.FIREBASE_ADMIN_PROJECT_ID,
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ].some((configured) => configured && configured !== projectId) ||
    (process.env.NEXT_PUBLIC_FIREBASE_ENVIRONMENT &&
      process.env.NEXT_PUBLIC_FIREBASE_ENVIRONMENT !== "local") ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_ADMIN_PRIVATE_KEY ||
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL ||
    process.env.FIREBASE_TOKEN ||
    process.env.API_FOOTBALL_KEY
  )
    throw new Error(
      "Remove conflicting project settings and Firebase credentials before running the preview.",
    );

  const source = await readFile(input, "utf8");
  if (Buffer.byteLength(source, "utf8") > 2 * 1024 * 1024)
    throw new Error("Wrapped ledger must be no larger than 2 MiB.");
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    throw new Error("Wrapped ledger must be valid UTF-8 JSON.");
  }
  const ledger = parseWrappedLedger(json);
  const database = new Firestore({ projectId, host, ssl: false });
  try {
    const report = await previewWrappedCoverage(
      database,
      ledger,
      tournament,
      asOf,
    );
    console.log(JSON.stringify(report, null, 2));
    if (!report.coverageComplete) process.exitCode = 2;
  } finally {
    await database.terminate();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Wrapped preview failed.",
  );
  process.exitCode = 1;
});
