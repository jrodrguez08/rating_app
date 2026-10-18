import { pathToFileURL } from "node:url";

import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import {
  type DocumentData,
  type Firestore,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";

import {
  membershipFromParticipant,
  membershipFromPlayer,
  mergeTeamPlayerMembership,
} from "../src/application/team-player-membership";
import initialTeam from "../firebase/seed/initial-team.json";
import type {
  Match,
  MatchParticipant,
  Player,
  TeamPlayerMembership,
} from "../src/domain/models";
import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";

const MATCH_LIMIT = 100;
const PLAYER_LIMIT = 1_000;
const PARTICIPANT_LIMIT = 40;

export interface MembershipBackfillArguments {
  projectId: string;
  teamId: string;
  apply: boolean;
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
    const database = getFirestore(app);
    const memberships = await collectMemberships(database, arguments_.teamId);
    console.log(
      JSON.stringify({
        operation: "team-player-membership-backfill",
        mode: arguments_.apply ? "apply" : "dry-run",
        projectId: arguments_.projectId,
        teamId: arguments_.teamId,
        membershipCount: memberships.size,
        matchLimit: MATCH_LIMIT,
        playerLimit: PLAYER_LIMIT,
        participantLimit: PARTICIPANT_LIMIT,
      }),
    );
    if (!arguments_.apply) return;
    await writeMemberships(database, arguments_.teamId, memberships);
    console.log(
      JSON.stringify({
        operation: "team-player-membership-backfill",
        status: "completed",
        writes: memberships.size,
      }),
    );
  } finally {
    await deleteApp(app);
  }
}

async function collectMemberships(database: Firestore, teamId: string) {
  const [playersSnapshot, matchesSnapshot, existingMembershipSnapshot] =
    await Promise.all([
      database
        .collection("players")
        .where("currentTeamId", "==", teamId)
        .limit(PLAYER_LIMIT)
        .get(),
      database
        .collection("matches")
        .where("trackedTeamId", "==", teamId)
        .orderBy("kickoffAt", "desc")
        .limit(MATCH_LIMIT)
        .get(),
      database
        .collection(`teams/${teamId}/playerMemberships`)
        .limit(PLAYER_LIMIT)
        .get(),
    ]);
  const memberships = new Map(
    existingMembershipSnapshot.docs.map((snapshot) => {
      const membership = fromDocument<TeamPlayerMembership>(
        snapshot.id,
        snapshot.data(),
      );
      return [membership.playerId, membership] as const;
    }),
  );
  for (const snapshot of playersSnapshot.docs) {
    const player = fromDocument<Player>(snapshot.id, snapshot.data());
    const membership = membershipFromPlayer(player, player.updatedAt);
    if (membership) {
      memberships.set(
        player.id,
        mergeTeamPlayerMembership(memberships.get(player.id), membership),
      );
    }
  }
  for (const matchSnapshot of matchesSnapshot.docs) {
    const match = fromDocument<Match>(matchSnapshot.id, matchSnapshot.data());
    const participantSnapshot = await database
      .collection(`matches/${match.id}/participants`)
      .where("teamId", "==", teamId)
      .limit(PARTICIPANT_LIMIT)
      .get();
    for (const snapshot of participantSnapshot.docs) {
      const participant = fromDocument<MatchParticipant>(
        snapshot.id,
        snapshot.data(),
      );
      const membership = membershipFromParticipant(participant);
      memberships.set(
        membership.playerId,
        mergeTeamPlayerMembership(
          memberships.get(membership.playerId),
          membership,
        ),
      );
    }
  }
  return memberships;
}

async function writeMemberships(
  database: Firestore,
  teamId: string,
  memberships: ReadonlyMap<string, TeamPlayerMembership>,
) {
  const entries = [...memberships.values()];
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = database.batch();
    for (const membership of entries.slice(offset, offset + 400)) {
      const reference = database.doc(
        `teams/${teamId}/playerMemberships/${membership.playerId}`,
      );
      batch.set(reference, toDocument(membership), { merge: true });
    }
    await batch.commit();
  }
}

function fromDocument<T>(id: string, data: DocumentData): T {
  return {
    ...Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof Timestamp ? value.toDate().toISOString() : value,
      ]),
    ),
    id,
  } as T;
}

function toDocument(value: TeamPlayerMembership): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
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
