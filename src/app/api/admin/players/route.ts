import type { NextRequest } from "next/server";

import { AdminConsoleService } from "@/lib/firebase/admin-console";
import { emitOperationalLog } from "@/lib/operational-log";
import {
  adminError,
  adminJson,
  requireAdminRequest,
  requireAdminClub,
} from "@/lib/server/admin-request";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  let teamId: string | undefined;
  let completed = false;
  let returnedPlayers = 0;
  const reads = { queries: 0, membershipDocuments: 0, documentReadEstimate: 0 };
  try {
    await requireAdminRequest(request);
    const club = requireAdminClub(request);
    teamId = club.teamId;
    const query = request.nextUrl.searchParams.get("query") ?? "";
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    if (query.length > 80) return adminJson({ players: [] }, 400);
    if (cursor && (cursor.length > 200 || cursor.includes("/"))) {
      return adminJson({ players: [] }, 400);
    }
    const page = await new AdminConsoleService(undefined, (read) => {
      // Lookup counts include missing documents. Empty queries have a minimum
      // one-read charge; failed RPC/index-entry billing is not observable here.
      reads.documentReadEstimate += Math.max(1, read.documents);
      if (read.kind === "membership_query") {
        reads.queries += 1;
        reads.membershipDocuments += read.documents;
      }
    }).searchPlayers(club.teamId, query, cursor);
    completed = true;
    returnedPlayers = page.players.length;
    return adminJson(page);
  } catch (error) {
    return adminError(error);
  } finally {
    if (teamId)
      emitOperationalLog(console.info, "admin.player_search", {
        teamId,
        ...reads,
        returnedPlayers,
        durationMs: Date.now() - startedAt,
        status: completed ? "completed" : "failed",
        clientAborted: request.signal.aborted,
      });
  }
}
