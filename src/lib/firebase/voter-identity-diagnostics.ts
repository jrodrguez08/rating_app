import { firebaseEnvironmentName } from "./config";
import { VoterIdentityError } from "./voter-auth";

type DiagnosticEnvironment = "local" | "development" | "production" | null;

export function reportVoterIdentityFailure(
  error: unknown,
  options: {
    environment?: DiagnosticEnvironment;
    nodeEnvironment?: string;
    logger?: (message: string, details?: object) => void;
  } = {},
): void {
  const environment = options.environment ?? firebaseEnvironmentName;
  const nodeEnvironment = options.nodeEnvironment ?? process.env.NODE_ENV;
  const logger = options.logger ?? console.error;

  if (environment === "production" || nodeEnvironment === "production") {
    logger("Unable to prepare the voter session.");
    return;
  }

  logger("Unable to prepare the voter session.", safeDiagnostic(error));
}

function safeDiagnostic(error: unknown): {
  code: "configuration" | "disabled" | "unavailable" | "unknown";
  causeCode?: string;
} {
  if (!(error instanceof VoterIdentityError)) return { code: "unknown" };
  const causeCode = readSafeCauseCode(error.cause);
  return {
    code: error.code,
    ...(causeCode === undefined ? {} : { causeCode }),
  };
}

function readSafeCauseCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return undefined;
  }
  const code = cause.code;
  return typeof code === "string" && /^(auth|app)\/[a-z0-9-]+$/.test(code)
    ? code
    : undefined;
}
