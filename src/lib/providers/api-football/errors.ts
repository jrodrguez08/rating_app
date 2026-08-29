export type ProviderErrorCode =
  | "missing-api-key"
  | "request-failed"
  | "rate-limited"
  | "malformed-response"
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
