import { pathToFileURL } from "node:url";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  planPlayerIdentityReconciliation,
  playerProviderAliasTransition,
} from "../src/application/reconcile-player-identities";
import { PLAYER_IDENTITY_RECONCILIATIONS } from "../src/config/player-identity-reconciliations";
import type { Player, PlayerProviderAlias } from "../src/domain/models";
import {
  playerProviderAliasId,
  providerEntityId,
} from "../src/domain/player-identity";
import { getServerFirestore } from "../src/lib/firebase/server";
import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";

const CONFIRMATION = "reconcile-player-identities";

export function parsePlayerIdentityReconciliationArguments(
  arguments_: readonly string[],
) {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) throw usageError();
    values.set(key, value);
  }
  const projectId = values.get("--project-id");
  const apply = values.get("--apply") === "true";
  const validDryRun = projectId !== undefined && values.size === 1;
  const validApply =
    projectId !== undefined &&
    apply &&
    values.get("--confirm") === CONFIRMATION &&
    values.size === 3;
  if (!validDryRun && !validApply) throw usageError();
  return { projectId, apply };
}

export async function main() {
  const arguments_ = parsePlayerIdentityReconciliationArguments(
    process.argv.slice(2),
  );
  const config = readFirebaseAdminRuntimeConfig();
  if (
    config.environment !== "production" ||
    config.emulator ||
    config.projectId.startsWith("demo-")
  ) {
    throw new Error(
      "Player identity reconciliation requires production mode without emulators.",
    );
  }
  if (config.projectId !== arguments_.projectId) {
    throw new Error("The confirmed project ID does not match Firebase Admin.");
  }
  const database = getServerFirestore();
  const timestamp = new Date().toISOString();
  const summaries = [];
  for (const reconciliation of PLAYER_IDENTITY_RECONCILIATIONS) {
    const plan = await loadPlan(database, reconciliation, timestamp);
    const applied = arguments_.apply
      ? await applyPlan(database, plan)
      : undefined;
    const canonicalPlayerUpdated =
      applied?.canonicalPlayerUpdated ?? plan.canonicalPlayerWrite !== null;
    summaries.push({
      canonicalPlayerId: plan.canonicalPlayerId,
      canonicalPlayerUpdated,
      canonicalPlayerPath: !canonicalPlayerUpdated
        ? null
        : `players/${plan.canonicalPlayerId}`,
      aliasWrites: applied?.aliasWrites ?? plan.aliasWrites.length,
      aliasPaths: (
        applied?.aliasIds ?? plan.aliasWrites.map(({ id }) => id)
      ).map((id) => `playerProviderAliases/${id}`),
      retainedLegacyPlayerIds: plan.retainedLegacyPlayerIds,
    });
  }
  console.log(
    JSON.stringify(
      { mode: arguments_.apply ? "apply" : "dry-run", summaries },
      null,
      2,
    ),
  );
}

type Reconciliation = (typeof PLAYER_IDENTITY_RECONCILIATIONS)[number];
type Plan = ReturnType<typeof planPlayerIdentityReconciliation>;

export async function loadPlan(
  database: Firestore,
  reconciliation: Reconciliation,
  timestamp: string,
): Promise<Plan> {
  const playerIds = reconciliation.externalPlayerIds.map((externalPlayerId) =>
    providerEntityId(
      "player",
      reconciliation.externalProvider,
      externalPlayerId,
    ),
  );
  const aliasIds = reconciliation.externalPlayerIds.map((externalPlayerId) =>
    playerProviderAliasId(reconciliation.externalProvider, externalPlayerId),
  );
  const snapshots = await database.getAll(
    ...playerIds.map((id) => database.doc(`players/${id}`)),
    ...aliasIds.map((id) => database.doc(`playerProviderAliases/${id}`)),
  );
  const players = new Map<string, Player>();
  const aliases = new Map<string, PlayerProviderAlias>();
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    if (snapshot.ref.parent.id === "players") {
      players.set(snapshot.id, fromSnapshot<Player>(snapshot));
    } else {
      aliases.set(snapshot.id, fromSnapshot<PlayerProviderAlias>(snapshot));
    }
  }
  return planPlayerIdentityReconciliation({
    reconciliation,
    players,
    persistedAliases: aliases,
    timestamp,
  });
}

export async function applyPlan(
  database: Firestore,
  plan: Plan,
): Promise<{
  canonicalPlayerUpdated: boolean;
  aliasWrites: number;
  aliasIds: string[];
}> {
  return database.runTransaction(async (transaction) => {
    const canonicalReference = database.doc(
      `players/${plan.canonicalPlayerId}`,
    );
    const aliasReferences = plan.aliasWrites.map((alias) =>
      database.doc(`playerProviderAliases/${alias.id}`),
    );
    const [canonicalSnapshot, ...aliasSnapshots] = await transaction.getAll(
      canonicalReference,
      ...aliasReferences,
    );
    if (!canonicalSnapshot.exists) {
      throw new Error(
        `Canonical Player ${plan.canonicalPlayerId} no longer exists.`,
      );
    }
    const canonical = fromSnapshot<Player>(canonicalSnapshot);
    if (
      canonical.externalProvider !== plan.canonicalPlayer.externalProvider ||
      canonical.externalProviderId !== plan.canonicalPlayer.externalProviderId
    ) {
      throw new Error(
        `Canonical Player ${plan.canonicalPlayerId} changed identity before apply.`,
      );
    }

    const canonicalUpdate: Partial<Player> = {};
    if (plan.canonicalPlayerWrite !== null) {
      if (
        canonical.position === undefined &&
        plan.canonicalPlayerWrite.position !== undefined
      ) {
        canonicalUpdate.position = plan.canonicalPlayerWrite.position;
      }
      if (
        canonical.photoUrl === undefined &&
        plan.canonicalPlayerWrite.photoUrl !== undefined
      ) {
        canonicalUpdate.photoUrl = plan.canonicalPlayerWrite.photoUrl;
      }
    }
    const canonicalPlayerUpdated = Object.keys(canonicalUpdate).length > 0;
    if (canonicalPlayerUpdated) {
      canonicalUpdate.updatedAt = plan.canonicalPlayerWrite!.updatedAt;
      transaction.update(canonicalReference, toDocument(canonicalUpdate));
    }

    let aliasWrites = 0;
    const aliasIds: string[] = [];
    plan.aliasWrites.forEach((alias, index) => {
      const snapshot = aliasSnapshots[index];
      const existing = snapshot?.exists
        ? fromSnapshot<PlayerProviderAlias>(snapshot)
        : undefined;
      const transition = playerProviderAliasTransition(existing, alias);
      if (transition === "unchanged") return;
      transaction.set(
        aliasReferences[index],
        toDocument({
          ...alias,
          createdAt: existing?.createdAt ?? alias.createdAt,
        }),
      );
      aliasWrites += 1;
      aliasIds.push(alias.id);
    });
    return { canonicalPlayerUpdated, aliasWrites, aliasIds };
  });
}

function fromSnapshot<T>(snapshot: {
  id: string;
  data(): Record<string, unknown> | undefined;
}): T {
  const data = snapshot.data() ?? {};
  return {
    ...Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof Timestamp ? value.toDate().toISOString() : value,
      ]),
    ),
    id: snapshot.id,
  } as T;
}

function toDocument(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, field]) => key !== "id" && field !== undefined)
      .map(([key, field]) => [
        key,
        key === "createdAt" || key === "updatedAt"
          ? Timestamp.fromDate(new Date(String(field)))
          : field,
      ]),
  );
}

function usageError() {
  return new Error(
    "Usage: npm run reconcile:player-identities -- --project-id <exact-project> [--apply true --confirm reconcile-player-identities]",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error("Player identity reconciliation failed.");
    process.exitCode = 1;
  });
}
