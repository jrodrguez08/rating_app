import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";

import { getServerFirestore } from "@/lib/firebase/server";
import { verifyAdminPassphrase } from "@/lib/server/admin-passphrase";

const PREVIEW_LIFETIME_MS = 5 * 60 * 1000;
const CHALLENGE_LIFETIME_MS = 2 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const VERIFICATION_LEASE_MS = 30 * 1000;
const MAX_FAILURES = 5;

export interface AdminCoachAction {
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
  coachId: string;
  coachName: string;
  externalProviderCoachId?: string;
  verificationSource: string;
  verificationReason: string;
}

export type AdminAuditAction =
  "coach_assignment_passphrase" | "coach_assignment_apply";

export class AdminSecurityError extends Error {
  constructor(
    public readonly code:
      | "invalid_passphrase"
      | "too_many_attempts"
      | "stale_preview"
      | "invalid_challenge",
  ) {
    super("No fue posible autorizar la operación.");
    this.name = "AdminSecurityError";
  }
}

export class AdminSecurityStore {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async issuePreview(
    operatorUid: string,
    action: AdminCoachAction,
  ): Promise<{ token: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + PREVIEW_LIFETIME_MS).toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        operatorUid,
        matchId: action.matchId,
        actionHash: hashAdminCoachAction(action),
        expiresAt,
      }),
    ).toString("base64url");
    const signature = signPreview(payload);
    return { token: `${payload}.${signature}`, expiresAt };
  }

  async authorizeAction(values: {
    operatorUid: string;
    action: AdminCoachAction;
    previewToken: string;
    passphrase: string;
  }): Promise<{ token: string; expiresAt: string }> {
    await this.requirePreview(
      values.operatorUid,
      values.action,
      values.previewToken,
    );
    await this.acquireAttemptLease(values.operatorUid);
    let accepted = false;
    try {
      accepted = await verifyAdminPassphrase(values.passphrase);
    } finally {
      await this.finishAttempt(values.operatorUid, accepted);
    }
    if (!accepted) throw new AdminSecurityError("invalid_passphrase");

    const token = randomBytes(32).toString("base64url");
    const reference = this.database.doc(
      `adminActionChallenges/${tokenDocumentId(token)}`,
    );
    const expiresAt = await this.database.runTransaction(
      async (transaction) => {
        const snapshot = await transaction.get(reference);
        const now = snapshot.readTime.toDate();
        const expiration = Timestamp.fromMillis(
          now.getTime() + CHALLENGE_LIFETIME_MS,
        );
        transaction.create(reference, {
          operatorUid: values.operatorUid,
          matchId: values.action.matchId,
          actionHash: hashAdminCoachAction(values.action),
          createdAt: Timestamp.fromDate(now),
          expiresAt: expiration,
        });
        return expiration;
      },
    );
    return { token, expiresAt: expiresAt.toDate().toISOString() };
  }

  async consumeChallenge(
    operatorUid: string,
    action: AdminCoachAction,
    token: string | undefined,
  ): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
      throw new AdminSecurityError("invalid_challenge");
    }
    const reference = this.database.doc(
      `adminActionChallenges/${tokenDocumentId(token)}`,
    );
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const now = snapshot.readTime.toDate();
      const data = snapshot.data();
      if (
        !snapshot.exists ||
        data?.operatorUid !== operatorUid ||
        data.matchId !== action.matchId ||
        data.actionHash !== hashAdminCoachAction(action) ||
        !(data.expiresAt instanceof Timestamp) ||
        data.expiresAt.toMillis() <= now.getTime() ||
        data.consumedAt !== undefined
      ) {
        throw new AdminSecurityError("invalid_challenge");
      }
      transaction.update(reference, { consumedAt: Timestamp.fromDate(now) });
    });
  }

  async audit(values: {
    operatorUid: string;
    action: AdminAuditAction;
    matchId: string;
    coachId?: string;
    evidenceReference?: string;
    verificationReason?: string;
    outcome: "success" | "rejected" | "failed";
  }): Promise<string> {
    const reference = await this.database.collection("adminAudit").add({
      operatorUid: values.operatorUid,
      action: values.action,
      matchId: values.matchId,
      ...(values.coachId ? { coachId: values.coachId } : {}),
      ...(values.evidenceReference
        ? { evidenceReference: values.evidenceReference }
        : {}),
      ...(values.verificationReason
        ? { verificationReason: values.verificationReason }
        : {}),
      outcome: values.outcome,
      createdAt: FieldValue.serverTimestamp(),
    });
    return reference.id;
  }

  private async requirePreview(
    operatorUid: string,
    action: AdminCoachAction,
    token: string,
  ): Promise<void> {
    if (token.length > 2_048) throw new AdminSecurityError("stale_preview");
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra || !safeSignature(payload, signature)) {
      throw new AdminSecurityError("stale_preview");
    }
    let data: unknown;
    try {
      data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new AdminSecurityError("stale_preview");
    }
    const expiresAt =
      typeof data === "object" &&
      data !== null &&
      "expiresAt" in data &&
      typeof data.expiresAt === "string"
        ? Date.parse(data.expiresAt)
        : Number.NaN;
    if (
      typeof data !== "object" ||
      data === null ||
      !("operatorUid" in data) ||
      data.operatorUid !== operatorUid ||
      !("matchId" in data) ||
      data.matchId !== action.matchId ||
      !("actionHash" in data) ||
      data.actionHash !== hashAdminCoachAction(action) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + PREVIEW_LIFETIME_MS
    ) {
      throw new AdminSecurityError("stale_preview");
    }
  }

  private async acquireAttemptLease(operatorUid: string): Promise<void> {
    const reference = this.database.doc(`adminSecurity/${operatorUid}`);
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const now = snapshot.readTime.toDate();
      const data = snapshot.data();
      const lockedUntil = timestampMillis(data?.lockedUntil);
      const leaseUntil = timestampMillis(data?.leaseUntil);
      if (lockedUntil > now.getTime() || leaseUntil > now.getTime()) {
        throw new AdminSecurityError("too_many_attempts");
      }
      transaction.set(
        reference,
        {
          failures: validFailures(data?.failures),
          windowStartedAt:
            data?.windowStartedAt instanceof Timestamp
              ? data.windowStartedAt
              : Timestamp.fromDate(now),
          leaseUntil: Timestamp.fromMillis(
            now.getTime() + VERIFICATION_LEASE_MS,
          ),
          updatedAt: Timestamp.fromDate(now),
        },
        { merge: true },
      );
    });
  }

  private async finishAttempt(
    operatorUid: string,
    accepted: boolean,
  ): Promise<void> {
    const reference = this.database.doc(`adminSecurity/${operatorUid}`);
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const now = snapshot.readTime.toDate();
      const data = snapshot.data();
      if (accepted) {
        transaction.set(
          reference,
          {
            failures: 0,
            windowStartedAt: Timestamp.fromDate(now),
            leaseUntil: FieldValue.delete(),
            lockedUntil: FieldValue.delete(),
            updatedAt: Timestamp.fromDate(now),
          },
          { merge: true },
        );
        return;
      }
      const windowStarted = timestampMillis(data?.windowStartedAt);
      const withinWindow = now.getTime() - windowStarted < ATTEMPT_WINDOW_MS;
      const failures = (withinWindow ? validFailures(data?.failures) : 0) + 1;
      transaction.set(
        reference,
        {
          failures,
          windowStartedAt: withinWindow
            ? data?.windowStartedAt
            : Timestamp.fromDate(now),
          leaseUntil: FieldValue.delete(),
          ...(failures >= MAX_FAILURES
            ? {
                lockedUntil: Timestamp.fromMillis(now.getTime() + LOCKOUT_MS),
              }
            : { lockedUntil: FieldValue.delete() }),
          updatedAt: Timestamp.fromDate(now),
        },
        { merge: true },
      );
    });
  }
}

export function hashAdminCoachAction(action: AdminCoachAction): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        matchId: action.matchId,
        trackedTeamId: action.trackedTeamId,
        externalFixtureId: action.externalFixtureId,
        coachId: action.coachId,
        coachName: action.coachName,
        externalProviderCoachId: action.externalProviderCoachId ?? null,
        verificationSource: action.verificationSource,
        verificationReason: action.verificationReason,
      }),
    )
    .digest("hex");
}

function tokenDocumentId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signPreview(payload: string): string {
  const key = process.env.ADMIN_PASSPHRASE_SCRYPT;
  if (!key || key.length < 64) {
    throw new Error("Admin passphrase configuration is unavailable.");
  }
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeSignature(payload: string, signature: string): boolean {
  const expected = Buffer.from(signPreview(payload));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function timestampMillis(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

function validFailures(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}
