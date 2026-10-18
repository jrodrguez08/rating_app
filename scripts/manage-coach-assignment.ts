import { pathToFileURL } from "node:url";

import { initialClub } from "../src/config/club";
import {
  AdminVerifiedCoachService,
  getServerFirestore,
} from "../src/lib/firebase/server";
import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";
import { requireVotingWindowOperator } from "./manage-voting-window";

type Environment = Readonly<Record<string, string | undefined>>;

export interface CoachAssignmentArguments {
  projectId: string;
  matchId: string;
  fixtureId: string;
  coachId: string;
  coachName: string;
  providerCoachId?: string;
  verificationSource: string;
  verificationReason: string;
  apply: boolean;
}

export function parseCoachAssignmentArguments(
  arguments_: readonly string[],
): CoachAssignmentArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) throw usageError();
    values.set(key, value);
  }
  const projectId = values.get("--project-id");
  const matchId = values.get("--match-id");
  const fixtureId = values.get("--fixture-id");
  const coachId = values.get("--coach-id");
  const coachName = values.get("--coach-name")?.trim();
  const providerCoachId = values.get("--provider-coach-id");
  const verificationSource = values.get("--source");
  const verificationReason = values.get("--reason")?.trim();
  const apply = values.get("--apply") === "true";
  const expectedSize =
    7 + (providerCoachId === undefined ? 0 : 1) + (apply ? 2 : 0);
  if (
    values.size !== expectedSize ||
    !projectId ||
    projectId.startsWith("demo-") ||
    !safeId(matchId) ||
    !safeId(fixtureId) ||
    !safeId(coachId) ||
    !coachName ||
    coachName.length > 120 ||
    (providerCoachId !== undefined && !/^\d+$/.test(providerCoachId)) ||
    !validEvidenceUrl(verificationSource) ||
    !verificationReason ||
    verificationReason.length < 10 ||
    verificationReason.length > 500 ||
    (apply &&
      (values.get("--confirm") !== `assign-verified-coach:${matchId}` ||
        values.get("--apply") !== "true")) ||
    (!apply && (values.has("--apply") || values.has("--confirm")))
  ) {
    throw usageError();
  }
  return {
    projectId,
    matchId,
    fixtureId,
    coachId,
    coachName,
    ...(providerCoachId === undefined ? {} : { providerCoachId }),
    verificationSource,
    verificationReason,
    apply,
  };
}

export function requireCoachOperatorId(
  environment: Environment = process.env,
): string {
  const value = environment.VOTING_WINDOW_OPERATOR_ID?.trim();
  if (!value || !/^[A-Za-z0-9_.@-]{1,128}$/.test(value)) {
    throw new Error("Operator identity is not configured.");
  }
  return value;
}

export async function main() {
  const arguments_ = parseCoachAssignmentArguments(process.argv.slice(2));
  requireVotingWindowOperator();
  const operatorId = requireCoachOperatorId();
  const config = readFirebaseAdminRuntimeConfig();
  if (
    config.environment !== "production" ||
    config.emulator ||
    config.projectId.startsWith("demo-")
  ) {
    throw new Error(
      "Verified coach assignment requires production mode without emulators.",
    );
  }
  if (config.projectId !== arguments_.projectId) {
    throw new Error("The confirmed project ID does not match Firebase Admin.");
  }
  const plan = await new AdminVerifiedCoachService(getServerFirestore()).assign(
    {
      matchId: arguments_.matchId,
      trackedTeamId: initialClub.teamId,
      externalFixtureId: arguments_.fixtureId,
      coachId: arguments_.coachId,
      coachName: arguments_.coachName,
      ...(arguments_.providerCoachId === undefined
        ? {}
        : { externalProviderCoachId: arguments_.providerCoachId }),
      verificationSource: arguments_.verificationSource,
      verificationReason: arguments_.verificationReason,
      operatorId,
    },
    arguments_.apply,
  );
  console.log(
    JSON.stringify(
      { status: arguments_.apply ? "applied" : "dry_run", ...plan },
      null,
      2,
    ),
  );
}

function safeId(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validEvidenceUrl(value: string | undefined): value is string {
  if (value === undefined) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function usageError() {
  return new Error(
    "Usage: npm run manage:coach-assignment -- --project-id <production-project> --match-id <match-id> --fixture-id <fixture-id> --coach-id <coach-id> --coach-name <name> [--provider-coach-id <numeric-id>] --source <https-url> --reason <text> [--apply true --confirm assign-verified-coach:<match-id>]",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Verified coach assignment failed.",
      }),
    );
    process.exitCode = 1;
  });
}
