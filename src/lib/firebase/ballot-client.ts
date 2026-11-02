import { matchApiPath, type Club } from "@/config/club";
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
  | "invalid_match"
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
  "invalid_match",
  "unauthorized",
]);

export async function getBallotStatus(
  club: Club,
  matchId: string,
): Promise<BallotClientStatus> {
  return request(club, matchId, { method: "GET" });
}

export async function submitBallot(
  club: Club,
  matchId: string,
  ratings: BallotRatings,
): Promise<BallotClientStatus> {
  return request(club, matchId, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ratings),
  });
}

async function request(
  club: Club,
  matchId: string,
  init: RequestInit,
): Promise<BallotClientStatus> {
  const token = await getVoterIdToken();
  const response = await fetch(matchApiPath(club, matchId, "/ballot"), {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
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
