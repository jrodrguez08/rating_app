import { requireActiveClub } from "@/config/club-server";
import { AdminResultService } from "@/lib/firebase/server";
import { verifyVoterRequest } from "@/lib/server/voter-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clubSlug: string; matchId: string }> },
) {
  const voterId = await verifyVoterRequest(
    request.headers.get("authorization"),
  );
  if (voterId === null) return json({ status: "unauthorized" }, 401);
  const { clubSlug, matchId } = await params;
  const club = requireActiveClub(clubSlug);
  if (!MATCH_ID_PATTERN.test(matchId))
    return json({ status: "invalid_match" }, 400);
  try {
    const result = await new AdminResultService().getVoteComparison(
      matchId,
      club.teamId,
      voterId,
    );
    return json(
      result,
      result.status === "locked"
        ? 403
        : result.status === "invalid_match"
          ? 404
          : result.status === "unavailable"
            ? 503
            : 200,
    );
  } catch {
    console.error("Vote comparison read failed.", { matchId });
    return json({ status: "unavailable" }, 503);
  }
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
