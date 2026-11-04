import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import {
  coachWithSearchIndex,
  COACH_SEARCH_INDEX_VERSION,
} from "../src/application/coach-search";
import {
  coachProviderAliasId,
  proposedCoachProviderAlias,
  resolvePersistedCoachProviderAlias,
} from "../src/domain/coach-identity";
import type {
  Coach,
  CoachAssignment,
  CoachProviderAlias,
  VerifiedCoachAssignment,
} from "../src/domain/models";
import { readAllQueryPages } from "../src/lib/firebase/team-player-discovery";
import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";

const PAGE_SIZE = 100;

export interface CoachBackfillArguments {
  projectId: string;
  apply: boolean;
}

export function parseCoachBackfillArguments(
  arguments_: readonly string[],
): CoachBackfillArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) {
      throw usageError();
    }
    values.set(key, value);
  }
  const projectId = values.get("--project-id");
  const applyValue = values.get("--apply");
  const apply = applyValue === "true";
  if (
    !projectId ||
    projectId.startsWith("demo-") ||
    (applyValue !== undefined && applyValue !== "true") ||
    [...values.keys()].some(
      (key) => !["--project-id", "--apply", "--confirm"].includes(key),
    ) ||
    (apply &&
      values.get("--confirm") !== `backfill-coach-search:${projectId}`) ||
    (!apply && values.has("--confirm"))
  ) {
    throw usageError();
  }
  return { projectId, apply };
}

export async function runCoachSearchBackfill(
  database: Firestore,
  apply: boolean,
): Promise<{
  coachesScanned: number;
  assignmentsScanned: number;
  verifiedScanned: number;
  aliasesScanned: number;
  changedCoaches: number;
  blockingIssues: number;
  indexStatus: "complete" | "incomplete";
  writes: number;
}> {
  const [coachDocs, assignments, verified, aliases] = await Promise.all([
    readAllQueryPages(
      database.collection("coaches"),
      "coaches",
      PAGE_SIZE,
      () => undefined,
    ),
    readAllQueryPages(
      database.collectionGroup("coachAssignments"),
      "coachAssignments",
      PAGE_SIZE,
      () => undefined,
    ),
    readAllQueryPages(
      database.collectionGroup("verifiedCoachAssignments"),
      "verifiedCoachAssignments",
      PAGE_SIZE,
      () => undefined,
    ),
    readAllQueryPages(
      database.collection("coachProviderAliases"),
      "coachProviderAliases",
      PAGE_SIZE,
      () => undefined,
    ),
  ]);
  const coaches = new Map(
    coachDocs.map((document) => [document.id, fromSnapshot<Coach>(document)]),
  );
  const teams = new Map<string, Set<string>>();
  const hiddenByAlias = new Set<string>();
  const byProviderIdentity = new Map<string, Coach[]>();
  for (const coach of coaches.values()) {
    if (!coach.externalProvider || !coach.externalProviderId) continue;
    const key = JSON.stringify([
      coach.externalProvider,
      coach.externalProviderId,
    ]);
    const matches = byProviderIdentity.get(key) ?? [];
    matches.push(coach);
    byProviderIdentity.set(key, matches);
  }
  const canonicalBindings = new Map<string, string>();
  let blockingIssues = 0;
  const add = (coachId: string, teamId: string) => {
    if (!coaches.has(coachId) || !teamId) {
      blockingIssues += 1;
      return;
    }
    const associated = teams.get(coachId) ?? new Set<string>();
    associated.add(teamId);
    teams.set(coachId, associated);
  };
  for (const document of assignments) {
    const assignment = fromSnapshot<CoachAssignment>(document);
    add(assignment.coachId, assignment.teamId);
  }
  for (const document of verified) {
    const assignment = fromSnapshot<VerifiedCoachAssignment>(document);
    add(assignment.coachId, assignment.trackedTeamId);
  }
  for (const document of aliases) {
    const alias = fromSnapshot<CoachProviderAlias>(document);
    const canonical = coaches.get(alias.canonicalCoachId);
    if (
      !alias.externalProvider ||
      !alias.externalProviderCoachId ||
      !canonical ||
      document.id !==
        coachProviderAliasId(
          alias.externalProvider,
          alias.externalProviderCoachId,
        )
    ) {
      blockingIssues += 1;
      continue;
    }
    const key = JSON.stringify([
      alias.externalProvider,
      alias.externalProviderCoachId,
    ]);
    const matches = byProviderIdentity.get(key) ?? [];
    const priorBinding = canonicalBindings.get(canonical.id);
    if (
      matches.length === 0 ||
      ((canonical.externalProvider || canonical.externalProviderId) &&
        (canonical.externalProvider !== alias.externalProvider ||
          canonical.externalProviderId !== alias.externalProviderCoachId)) ||
      (priorBinding && priorBinding !== key)
    ) {
      blockingIssues += 1;
      continue;
    }
    try {
      resolvePersistedCoachProviderAlias(
        alias,
        proposedCoachProviderAlias(
          alias.externalProvider,
          alias.externalProviderCoachId,
          alias.createdAt,
          canonical.id,
        ),
      );
    } catch {
      blockingIssues += 1;
      continue;
    }
    canonicalBindings.set(canonical.id, key);
    for (const source of matches) {
      if (source.id !== canonical.id) hiddenByAlias.add(source.id);
      for (const teamId of source.associatedTeamIds ?? []) {
        add(canonical.id, teamId);
      }
      for (const teamId of teams.get(source.id)?.values() ?? []) {
        add(canonical.id, teamId);
      }
    }
  }
  const indexed = new Map(
    [...coaches.values()].map((coach) => [
      coach.id,
      coachWithSearchIndex(
        coach,
        [...(coach.associatedTeamIds ?? []), ...(teams.get(coach.id) ?? [])],
        hiddenByAlias.has(coach.id),
      ),
    ]),
  );
  const changed = [...coaches.values()].filter((coach) => {
    const prepared = indexed.get(coach.id)!;
    return (
      !isDeepStrictEqual(coach.associatedTeamIds, prepared.associatedTeamIds) ||
      !isDeepStrictEqual(
        coach.searchHiddenByAlias,
        prepared.searchHiddenByAlias,
      ) ||
      !isDeepStrictEqual(coach.searchPrefixes, prepared.searchPrefixes) ||
      !isDeepStrictEqual(coach.teamBrowseKeys, prepared.teamBrowseKeys) ||
      !isDeepStrictEqual(coach.teamSearchKeys, prepared.teamSearchKeys) ||
      !isDeepStrictEqual(
        coach.unassociatedSearchKeys,
        prepared.unassociatedSearchKeys,
      )
    );
  });
  const indexStatus = blockingIssues === 0 ? "complete" : "incomplete";
  if (apply) {
    await database.doc("coachSearchIndex/state").set({
      status: "incomplete",
      schemaVersion: COACH_SEARCH_INDEX_VERSION,
      blockingIssueCount: blockingIssues,
      auditedAt: Timestamp.now(),
    });
    for (let offset = 0; offset < changed.length; offset += 400) {
      const batch = database.batch();
      for (const coach of changed.slice(offset, offset + 400)) {
        const prepared = indexed.get(coach.id)!;
        batch.update(database.doc(`coaches/${coach.id}`), {
          associatedTeamIds: prepared.associatedTeamIds,
          searchHiddenByAlias: prepared.searchHiddenByAlias,
          searchPrefixes: prepared.searchPrefixes,
          teamBrowseKeys: prepared.teamBrowseKeys,
          teamSearchKeys: prepared.teamSearchKeys,
          unassociatedSearchKeys: prepared.unassociatedSearchKeys,
        });
      }
      await batch.commit();
    }
    await database.doc("coachSearchIndex/state").set({
      status: indexStatus,
      schemaVersion: COACH_SEARCH_INDEX_VERSION,
      blockingIssueCount: blockingIssues,
      baselineCoachCount: coaches.size,
      baselineAssignmentCount: assignments.length + verified.length,
      auditedAt: Timestamp.now(),
    });
  }
  return {
    coachesScanned: coaches.size,
    assignmentsScanned: assignments.length,
    verifiedScanned: verified.length,
    aliasesScanned: aliases.length,
    changedCoaches: changed.length,
    blockingIssues,
    indexStatus,
    writes: apply ? changed.length + 2 : 0,
  };
}

async function main() {
  const arguments_ = parseCoachBackfillArguments(process.argv.slice(2));
  const config = readFirebaseAdminRuntimeConfig();
  if (config.environment !== "production" || config.emulator) {
    throw new Error(
      "Coach search backfill requires production mode without emulators.",
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
    `coach-search-backfill-${Date.now()}`,
  );
  try {
    console.log(
      JSON.stringify({
        operation: "coach-search-backfill",
        mode: arguments_.apply ? "apply" : "dry-run",
        projectId: arguments_.projectId,
        ...(await runCoachSearchBackfill(getFirestore(app), arguments_.apply)),
      }),
    );
  } finally {
    await deleteApp(app);
  }
}

function fromSnapshot<T>(snapshot: {
  id: string;
  data(): DocumentData | undefined;
}): T {
  const data = snapshot.data();
  if (!data) throw new Error("Backfill document has no data.");
  return { ...data, id: snapshot.id } as T;
}

function usageError() {
  return new Error(
    "Usage: npm run backfill:coach-search -- --project-id <project> [--apply true --confirm backfill-coach-search:<project>]",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Coach search backfill failed.",
    );
    process.exitCode = 1;
  });
}
