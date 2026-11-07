import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import {
  WRAPPED_SNAPSHOT_SCHEMA,
  WrappedSnapshotError,
} from "@/application/wrapped-snapshot";
import { AdminSecurityError } from "@/lib/firebase/admin-security";
import {
  loadWrappedCandidate,
  parseSnapshotLedger,
} from "@/lib/firebase/wrapped-snapshot-evidence";
import {
  publicationRef,
  wrappedDependencyRef,
  type WrappedPublication,
} from "@/lib/firebase/wrapped-publication";
import { adminChallengeDocumentId } from "@/lib/server/admin-coach-action";
import {
  adminWrappedResourceId,
  hashAdminWrappedAction,
  type AdminWrappedAction,
} from "@/lib/server/admin-wrapped-action";
import { wrappedLocalEnabled } from "@/lib/server/wrapped-local";

interface WrappedReceipt {
  operation: AdminWrappedAction["wrappedOperation"];
  version: number;
  digest: string;
}

function requireLocal() {
  if (!wrappedLocalEnabled()) throw new WrappedSnapshotError("unavailable");
}

function readPublication(
  data: DocumentData | undefined,
  scope: Pick<AdminWrappedAction, "trackedTeamId" | "tournamentKey">,
): WrappedPublication {
  if (!data)
    return {
      teamId: scope.trackedTeamId,
      tournamentKey: scope.tournamentKey,
      epoch: 0,
      lastVersion: 0,
      active: null,
    };
  if (
    data.teamId !== scope.trackedTeamId ||
    data.tournamentKey !== scope.tournamentKey ||
    !Number.isSafeInteger(data.epoch) ||
    !Number.isSafeInteger(data.lastVersion)
  )
    throw new WrappedSnapshotError("edition_conflict");
  return {
    teamId: scope.trackedTeamId,
    tournamentKey: scope.tournamentKey,
    epoch: data.epoch,
    lastVersion: data.lastVersion,
    active: data.active,
  };
}

export class AdminWrappedService {
  constructor(private readonly database: Firestore) {}

  async preview(
    scope: Pick<
      AdminWrappedAction,
      "trackedTeamId" | "tournamentKey" | "wrappedOperation"
    >,
    ledger?: unknown,
  ) {
    requireLocal();
    const input =
      scope.wrappedOperation === "approve"
        ? parseSnapshotLedger(ledger, scope.trackedTeamId, scope.tournamentKey)
        : undefined;
    const reference = publicationRef(
      this.database,
      adminWrappedResourceId(scope),
    );
    return this.database.runTransaction(
      async (transaction) => {
        const state = readPublication(
          (await transaction.get(reference)).data(),
          scope,
        );
        if (!input) {
          if (!state.active) throw new WrappedSnapshotError("unavailable");
          return {
            action: {
              ...scope,
              epoch: state.epoch,
              digest: state.active.digest,
            },
          };
        }
        const candidate = await loadWrappedCandidate(
          this.database,
          transaction,
          input,
        );
        return {
          action: { ...scope, epoch: state.epoch, digest: candidate.digest },
          projection: candidate.projection,
          approvalEligible:
            candidate.projection.eligibility.meetsCoreSample &&
            candidate.projection.eligibility.qualifyingMatches > 0,
        };
      },
      { readOnly: true },
    );
  }

  applyAuthorized(
    action: AdminWrappedAction,
    operatorUid: string,
    token: string | undefined,
    ledger?: unknown,
  ) {
    requireLocal();
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AdminSecurityError("invalid_challenge");
    const challengeId = adminChallengeDocumentId(token);
    const auditId = `wrapped-${challengeId}`;
    const resourceId = adminWrappedResourceId(action);
    const actionHash = hashAdminWrappedAction(action);
    const reference = publicationRef(this.database, resourceId);
    return this.database.runTransaction(async (transaction) => {
      const challengeRef = this.database.doc(
        `adminActionChallenges/${challengeId}`,
      );
      const auditRef = this.database.doc(`adminAudit/${auditId}`);
      const challengeDoc = await transaction.get(challengeRef);
      const challenge = challengeDoc.data();
      if (
        challenge?.operatorUid !== operatorUid ||
        challenge.resourceId !== resourceId ||
        challenge.actionHash !== actionHash ||
        !(challenge.expiresAt instanceof Timestamp)
      )
        throw new AdminSecurityError("invalid_challenge");
      if (challenge.consumedAt !== undefined) {
        const audit = (await transaction.get(auditRef)).data();
        if (
          challenge.committedAuditId !== auditId ||
          audit?.operatorUid !== operatorUid ||
          audit.action !== "wrapped_apply" ||
          audit.actionHash !== actionHash ||
          audit.outcome !== "success"
        )
          throw new AdminSecurityError("invalid_challenge");
        return {
          receipt: audit.receipt as WrappedReceipt,
          disposition: "idempotent_retry" as const,
        };
      }
      if (challenge.expiresAt.toMillis() <= challengeDoc.readTime.toMillis())
        throw new AdminSecurityError("invalid_challenge");
      const state = readPublication(
        (await transaction.get(reference)).data(),
        action,
      );
      if (state.epoch !== action.epoch)
        throw new WrappedSnapshotError("stale_candidate");
      const now = challengeDoc.readTime;
      let receipt: WrappedReceipt;
      if (action.wrappedOperation === "withdraw") {
        if (!state.active || state.active.digest !== action.digest)
          throw new WrappedSnapshotError("stale_candidate");
        receipt = { operation: "withdraw", ...state.active };
        transaction.update(reference, {
          active: null,
          epoch: state.epoch + 1,
          withdrawnAt: now,
        });
      } else {
        const input = parseSnapshotLedger(
          ledger,
          action.trackedTeamId,
          action.tournamentKey,
        );
        const candidate = await loadWrappedCandidate(
          this.database,
          transaction,
          input,
        );
        if (
          candidate.digest !== action.digest ||
          !candidate.projection.eligibility.meetsCoreSample ||
          candidate.projection.eligibility.qualifyingMatches === 0
        )
          throw new WrappedSnapshotError("stale_candidate");
        const privateRef = reference
          .collection("versions")
          .doc(candidate.digest);
        if ((await transaction.get(privateRef)).exists)
          throw new WrappedSnapshotError("stale_candidate");
        const dependencies = input.tournament.fixtures.map(({ matchId }) =>
          wrappedDependencyRef(this.database, matchId),
        );
        for (const dependency of await transaction.getAll(...dependencies)) {
          const existing = dependency.data();
          if (
            existing &&
            (existing.teamId !== state.teamId ||
              existing.tournamentKey !== state.tournamentKey)
          )
            throw new WrappedSnapshotError("edition_conflict");
        }
        const version = state.lastVersion + 1;
        receipt = { operation: "approve", version, digest: candidate.digest };
        const active = { version, digest: candidate.digest };
        transaction.create(privateRef, {
          ...active,
          manifest: candidate.manifest,
          approvedAt: now,
          operatorUid,
          auditId,
        });
        transaction.create(
          reference.collection("projections").doc(String(version)),
          {
            ...active,
            schema: WRAPPED_SNAPSHOT_SCHEMA,
            body: candidate.projectionJson,
          },
        );
        transaction.set(reference, {
          ...state,
          active,
          lastVersion: version,
          epoch: state.epoch + 1,
        });
        for (const dependency of dependencies) {
          transaction.set(dependency, {
            teamId: state.teamId,
            tournamentKey: state.tournamentKey,
            version,
          });
        }
      }
      transaction.update(challengeRef, {
        consumedAt: now,
        committedAuditId: auditId,
      });
      transaction.create(auditRef, {
        action: "wrapped_apply",
        resourceId,
        operatorUid,
        actionHash,
        receipt,
        outcome: "success",
        createdAt: now,
      });
      return { receipt, disposition: "committed" as const };
    });
  }
}
