export type ProviderErrorCode =
  | "missing-api-key"
  | "request-failed"
  | "rate-limited"
  | "malformed-response"
  | "fixture-not-found"
  | "lineup-unavailable"
  | "tracked-team-missing"
  | "coach-missing"
  | "ambiguous-coach"
  | "team-not-found"
  | "ambiguous-team";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}
