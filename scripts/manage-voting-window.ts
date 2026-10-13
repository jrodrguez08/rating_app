import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  AdminVotingWindowService,
  getServerFirestore,
} from "../src/lib/firebase/server";
import { readFirebaseAdminRuntimeConfig } from "../src/lib/server/environment";

type Environment = Readonly<Record<string, string | undefined>>;

export type VotingWindowArguments =
  | {
      operation: "reopen";
      projectId: string;
      matchId: string;
      closesAt: Date;
      apply: boolean;
    }
  | {
      operation: "close";
      projectId: string;
      matchId: string;
      apply: boolean;
    };

export function parseVotingWindowArguments(
  arguments_: readonly string[],
): VotingWindowArguments {
  const operation = arguments_[0];
  if (operation !== "reopen" && operation !== "close") throw usageError();
  const values = new Map<string, string>();
  const rest = arguments_.slice(1);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) throw usageError();
    values.set(key, value);
  }
  const projectId = values.get("--project-id");
  const matchId = values.get("--match-id");
  const apply = values.get("--apply") === "true";
  if (
    !projectId ||
    projectId.startsWith("demo-") ||
    !matchId ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(matchId)
  ) {
    throw usageError();
  }
  const expectedConfirm = `${operation}-voting-window:${matchId}`;
  const commonKeys = apply ? 4 : 2;
  if (
    (apply &&
      (values.get("--confirm") !== expectedConfirm ||
        values.get("--apply") !== "true")) ||
    (!apply && (values.has("--apply") || values.has("--confirm")))
  ) {
    throw usageError();
  }
  if (operation === "close") {
    if (values.size !== commonKeys || values.has("--close-at"))
      throw usageError();
    return { operation, projectId, matchId, apply };
  }
  const closeAtValue = values.get("--close-at");
  if (
    values.size !== commonKeys + 1 ||
    closeAtValue === undefined ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(closeAtValue)
  ) {
    throw usageError();
  }
  const closesAt = new Date(closeAtValue);
  if (!Number.isFinite(closesAt.getTime())) throw usageError();
  return { operation, projectId, matchId, closesAt, apply };
}

export function requireVotingWindowOperator(
  environment: Environment = process.env,
): void {
  const expectedHex = environment.VOTING_WINDOW_OPERATOR_SECRET_SHA256?.trim();
  const token = environment.VOTING_WINDOW_OPERATOR_TOKEN;
  if (!expectedHex || !/^[a-fA-F0-9]{64}$/.test(expectedHex) || !token) {
    throw new Error("Operator authorization failed.");
  }
  const expected = Buffer.from(expectedHex, "hex");
  const actual = createHash("sha256").update(token, "utf8").digest();
  if (!timingSafeEqual(expected, actual)) {
    throw new Error("Operator authorization failed.");
  }
}

export async function main() {
  const arguments_ = parseVotingWindowArguments(process.argv.slice(2));
  requireVotingWindowOperator();
  const config = readFirebaseAdminRuntimeConfig();
  if (
    config.environment !== "production" ||
    config.emulator ||
    config.projectId.startsWith("demo-")
  ) {
    throw new Error(
      "Voting-window operations require production mode without emulators.",
    );
  }
  if (config.projectId !== arguments_.projectId) {
    throw new Error("The confirmed project ID does not match Firebase Admin.");
  }
  const service = new AdminVotingWindowService(getServerFirestore());
  const plan =
    arguments_.operation === "reopen"
      ? await service.reopen(
          arguments_.matchId,
          arguments_.closesAt,
          arguments_.apply,
        )
      : arguments_.apply
        ? await service.close(arguments_.matchId)
        : await service.planClose(arguments_.matchId);
  console.log(
    JSON.stringify(
      {
        status: arguments_.apply ? "applied" : "dry_run",
        ...plan,
      },
      null,
      2,
    ),
  );
}

function usageError() {
  return new Error(
    "Usage: npm run manage:voting-window -- <reopen|close> --project-id <production-project> --match-id <match-id> [--close-at <ISO-UTC>] [--apply true --confirm <operation>-voting-window:<match-id>]",
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
            : "Voting-window operation failed.",
      }),
    );
    process.exitCode = 1;
  });
}
