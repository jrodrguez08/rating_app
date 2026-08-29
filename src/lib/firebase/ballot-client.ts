import type { BallotRatings } from "@/domain/models";

import { getVoterIdToken } from "./voter-auth";

export type BallotClientStatus =
  | "available"
  | "submitted"
  | "created"
  | "already_submitted"
  | "not_open"
  | "closed"
  | "data_unavailable"
  | "invalid_ballot"
  | "unauthorized";

const ballotStatuses = new Set<BallotClientStatus>([
  "available",
  "submitted",
  "created",
  "already_submitted",
  "not_open",
  "closed",
  "data_unavailable",
  "invalid_ballot",
  "unauthorized",
]);

export async function getBallotStatus(
  matchId: string,
): Promise<BallotClientStatus> {
  return request(matchId, { method: "GET" });
}

export async function submitBallot(
  matchId: string,
  ratings: BallotRatings,
): Promise<BallotClientStatus> {
  return request(matchId, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ratings),
  });
}

async function request(
  matchId: string,
  init: RequestInit,
): Promise<BallotClientStatus> {
  const token = await getVoterIdToken();
  const response = await fetch(
    `/api/matches/${encodeURIComponent(matchId)}/ballot`,
    {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    },
  );
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("status" in payload) ||
    typeof payload.status !== "string" ||
    !ballotStatuses.has(payload.status as BallotClientStatus)
  ) {
    throw new Error("Unexpected ballot response.");
  }
  return payload.status as BallotClientStatus;
}
