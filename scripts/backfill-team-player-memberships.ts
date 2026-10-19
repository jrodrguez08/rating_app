import { pathToFileURL } from "node:url";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

import initialTeam from "../firebase/seed/initial-team.json";
import type { TeamPlayerMembership } from "../src/domain/models";
import {
  changedMemberships,
  discoverTeamPlayers,
  readAllQueryPages,
} from "../src/lib/firebase/team-player-discovery";
import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";

const DEFAULT_PAGE_SIZE = 100;
const WRITE_BATCH_SIZE = 400;

export interface MembershipBackfillArguments {
  projectId: string;
  teamId: string;
  apply: boolean;
}

export interface MembershipBackfillTelemetry {
  playersScanned: number;
  matchesScanned: number;
  participantsScanned: number;
  verifiedLineupsScanned: number;
  aliasesScanned: number;
  existingMemberships: number;
  newMemberships: number;
  updatedMemberships: number;
  unchangedMemberships: number;
  unresolvedIdentities: number;
  skippedByReason: Record<string, number>;
  pages: {
    players: number;
    matches: number;
    participants: number;
    verifiedLineups: number;
    aliases: number;
    memberships: number;
    playerLookups: number;
  };
  finalUniqueMembershipCount: number;
  writes: number;
  plannedChanges: Array<{
    playerId: string;
    displayName: string;
    source: TeamPlayerMembership["source"];
    disposition: "create" | "update";
  }>;
}

export function parseMembershipBackfillArguments(
  arguments_: readonly string[],
): MembershipBackfillArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value) throw usageError();
    values.set(key, value);
  }
  const projectId = values.get("--project-id");
  const teamId = values.get("--team-id") ?? initialTeam.id;
  const applyValue = values.get("--apply");
  const apply = applyValue === "true";
  const allowed = new Set([
    "--project-id",
    "--team-id",
    "--apply",
    "--confirm",
  ]);
  if (
    !projectId ||
    (applyValue !== undefined && applyValue !== "true") ||
    [...values.keys()].some((key) => !allowed.has(key))
  ) {
    throw usageError();
  }
  if (projectId.startsWith("demo-")) {
    throw new Error("Production membership backfill rejects demo-* projects.");
  }
  if (
    apply &&
    values.get("--confirm") !== `backfill-team-player-memberships:${teamId}`
  ) {
    throw usageError();
  }
  if (!apply && values.has("--confirm")) throw usageError();
  return { projectId, teamId, apply };
}

export async function main() {
  const arguments_ = parseMembershipBackfillArguments(process.argv.slice(2));
  const config = readFirebaseAdminRuntimeConfig();
  if (config.environment !== "production" || config.emulator) {
    throw new Error(
      "Membership backfill requires production mode without emulators.",
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
    `team-player-membership-backfill-${Date.now()}`,
  );
  try {
    const telemetry = await runMembershipBackfill(
      getFirestore(app),
      arguments_.teamId,
      arguments_.apply,
    );
    console.log(
      JSON.stringify({
        operation: "team-player-membership-backfill",
        mode: arguments_.apply ? "apply" : "dry-run",
        projectId: arguments_.projectId,
        teamId: arguments_.teamId,
        ...telemetry,
      }),
    );
  } finally {
    await deleteApp(app);
  }
}

export async function runMembershipBackfill(
  database: Firestore,
  teamId: string,
  apply: boolean,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<MembershipBackfillTelemetry> {
  const discovery = await discoverTeamPlayers(database, teamId, pageSize);
  const { changed, created, updated, unchanged } =
    changedMemberships(discovery);
  if (apply) await writeMemberships(database, teamId, changed);
  return {
    ...discovery.telemetry,
    newMemberships: created,
    updatedMemberships: updated,
    unchangedMemberships: unchanged,
    finalUniqueMembershipCount: discovery.proposedMemberships.size,
    writes: apply ? changed.length : 0,
    plannedChanges: changed.map((membership) => ({
      playerId: membership.playerId,
      displayName: membership.displayName,
      source: membership.source,
      disposition: discovery.existingMemberships.has(membership.playerId)
        ? "update"
        : "create",
    })),
  };
}

export { readAllQueryPages };

async function writeMemberships(
  database: Firestore,
  teamId: string,
  memberships: readonly TeamPlayerMembership[],
) {
  for (
    let offset = 0;
    offset < memberships.length;
    offset += WRITE_BATCH_SIZE
  ) {
    const batch = database.batch();
    for (const membership of memberships.slice(
      offset,
      offset + WRITE_BATCH_SIZE,
    )) {
      batch.set(
        database.doc(
          `teams/${teamId}/playerMemberships/${membership.playerId}`,
        ),
        toDocument(membership),
        { merge: true },
      );
    }
    await batch.commit();
  }
}

function toDocument(value: TeamPlayerMembership): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [
        key,
        key.endsWith("At") && typeof item === "string"
          ? Timestamp.fromDate(new Date(item))
          : item,
      ]),
  );
}

function usageError() {
  return new Error(
    "Usage: npm run backfill:team-player-memberships -- --project-id <project> [--team-id <team>] [--apply true --confirm backfill-team-player-memberships:<team>]",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Membership backfill failed.",
    );
    process.exitCode = 1;
  });
}
