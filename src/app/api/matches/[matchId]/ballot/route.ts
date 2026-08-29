import { AdminBallotService } from "@/lib/firebase/server";
import { verifyVoterRequest } from "@/lib/server/voter-token";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const voterId = await verifyVoterRequest(
    request.headers.get("authorization"),
  );
  if (voterId === null) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }
  const { matchId } = await params;
  try {
    const submitted = await new AdminBallotService().hasSubmitted(
      matchId,
      voterId,
    );
    return Response.json({ status: submitted ? "submitted" : "available" });
  } catch {
    return Response.json({ status: "data_unavailable" }, { status: 503 });
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
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ status: "invalid_ballot" }, { status: 400 });
  }
  const { matchId } = await params;
  let result;
  try {
    result = await new AdminBallotService().submit(matchId, voterId, input);
  } catch {
    return Response.json({ status: "data_unavailable" }, { status: 503 });
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
  return Response.json(result, { status: statusCode });
}
