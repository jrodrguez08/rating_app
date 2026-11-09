export const coachErrorKeys = {
  COACH_INVALID_INPUT: "invalidInput",
  COACH_INVALID_SOURCE: "invalidSource",
  COACH_INVALID_REASON: "invalidReason",
  COACH_INVALID_IDENTITY: "invalidIdentity",
  COACH_ALIAS_CONFLICT: "aliasConflict",
  COACH_ALIAS_MISSING: "aliasMissing",
  COACH_RECONCILIATION_STALE: "reconciliationStale",
  COACH_PROVIDER_MISMATCH: "providerMismatch",
  COACH_INVALID_BINDING: "invalidBinding",
  COACH_ASSIGNMENT_CONFLICT: "assignmentConflict",
  COACH_INVALID_MATCH_STATE: "invalidMatchState",
  COACH_MATCH_NOT_FOUND: "matchNotFound",
  COACH_INVALID_CHALLENGE: "invalidChallenge",
  COACH_OPERATION_UNAVAILABLE: "unavailable",
} as const;

export type AdminCoachErrorCode = keyof typeof coachErrorKeys;

export class AdminVerifiedCoachAssignmentRejectedError extends Error {
  constructor(
    message: string,
    public readonly code: AdminCoachErrorCode = "COACH_INVALID_INPUT",
  ) {
    super(message);
    this.name = "AdminVerifiedCoachAssignmentRejectedError";
  }
}
