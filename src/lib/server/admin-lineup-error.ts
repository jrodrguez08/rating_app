export type AdminLineupErrorCode =
  | "LINEUP_INVALID_INPUT"
  | "LINEUP_MATCH_NOT_FOUND"
  | "LINEUP_INVALID_MATCH_STATE"
  | "LINEUP_INVALID_TEAM_BINDING"
  | "LINEUP_PLAYER_NOT_FOUND"
  | "LINEUP_PLAYER_NAME_CONFLICT"
  | "LINEUP_PLAYER_MEMBERSHIP_CONFLICT"
  | "LINEUP_PLAYER_ALIAS_CONFLICT"
  | "LINEUP_INTERNAL_IDENTITY_INVALID"
  | "LINEUP_INTERNAL_IDENTITY_CONFIGURATION_ERROR"
  | "LINEUP_DRAFT_STALE"
  | "LINEUP_PREVIEW_UNAVAILABLE";

export class AdminLineupError extends Error {
  constructor(
    readonly code: AdminLineupErrorCode,
    message: string,
    readonly participantName?: string,
  ) {
    super(message);
    this.name = "AdminLineupError";
  }
}

export class InternalPlayerIdentityConfigurationError extends Error {
  constructor() {
    super("Internal Player identity signing configuration is unavailable.");
    this.name = "InternalPlayerIdentityConfigurationError";
  }
}
