import { FirebaseError } from "firebase/app";
import { signInAnonymously } from "firebase/auth";

import type { VoterIdentity } from "@/domain/models";

import { getBrowserAuth } from "./browser";

export type VoterIdentityErrorCode =
  "configuration" | "disabled" | "unavailable" | "unknown";

export class VoterIdentityError extends Error {
  constructor(
    readonly code: VoterIdentityErrorCode,
    options?: ErrorOptions,
  ) {
    super("Unable to prepare voter identity.", options);
    this.name = "VoterIdentityError";
  }
}

let pendingIdentity: Promise<VoterIdentity> | undefined;

export function ensureAnonymousVoter(): Promise<VoterIdentity> {
  if (pendingIdentity !== undefined) return pendingIdentity;

  const attempt = prepareAnonymousVoter().catch((error: unknown) => {
    throw mapVoterIdentityError(error);
  });
  const sharedAttempt = attempt.finally(() => {
    if (pendingIdentity === sharedAttempt) pendingIdentity = undefined;
  });
  pendingIdentity = sharedAttempt;
  return sharedAttempt;
}

async function prepareAnonymousVoter(): Promise<VoterIdentity> {
  const auth = getBrowserAuth();
  await auth.authStateReady();
  if (auth.currentUser !== null) return { voterId: auth.currentUser.uid };

  const credential = await signInAnonymously(auth);
  return { voterId: credential.user.uid };
}

function mapVoterIdentityError(error: unknown): VoterIdentityError {
  if (error instanceof VoterIdentityError) return error;
  if (!(error instanceof FirebaseError)) {
    return new VoterIdentityError("configuration", { cause: error });
  }
  if (error.code === "auth/operation-not-allowed") {
    return new VoterIdentityError("disabled", { cause: error });
  }
  if (
    error.code === "auth/network-request-failed" ||
    error.code === "auth/internal-error"
  ) {
    return new VoterIdentityError("unavailable", { cause: error });
  }
  return new VoterIdentityError("unknown", { cause: error });
}
