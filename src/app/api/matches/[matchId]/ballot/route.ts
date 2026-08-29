import { AdminBallotService } from "@/lib/firebase/server";
import { verifyVoterRequest } from "@/lib/server/voter-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BALLOT_BYTES = 16 * 1024;
const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const voterId = await verifyVoterRequest(
    request.headers.get("authorization"),
  );
  if (voterId === null) {
    return json({ status: "unauthorized" }, 401);
  }
  const { matchId } = await params;
  if (!MATCH_ID_PATTERN.test(matchId))
    return json({ status: "invalid_match" }, 400);
  try {
    const submitted = await new AdminBallotService().hasSubmitted(
      matchId,
      voterId,
    );
    return json({ status: submitted ? "submitted" : "available" });
  } catch {
    console.error("Ballot status read failed.", { matchId });
    return json({ status: "data_unavailable" }, 503);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const voterId = await verifyVoterRequest(
    request.headers.get("authorization"),
  );
  if (voterId === null) {
    return json({ status: "unauthorized" }, 401);
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return json({ status: "invalid_ballot" }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_BALLOT_BYTES) {
    return json({ status: "invalid_ballot" }, 413);
  }
  let input: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BALLOT_BYTES) {
      return json({ status: "invalid_ballot" }, 413);
    }
    input = JSON.parse(body);
  } catch {
    return json({ status: "invalid_ballot" }, 400);
  }
  const { matchId } = await params;
  if (!MATCH_ID_PATTERN.test(matchId))
    return json({ status: "invalid_match" }, 400);
  let result;
  try {
    result = await new AdminBallotService().submit(matchId, voterId, input);
  } catch {
    console.error("Ballot submission failed.", { matchId });
    return json({ status: "data_unavailable" }, 503);
  }
  const statusCode =
    result.status === "created"
      ? 201
      : result.status === "already_submitted"
        ? 409
        : result.status === "invalid_ballot"
          ? 400
          : result.status === "data_unavailable"
            ? 503
            : 403;
  return json(result, statusCode);
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
