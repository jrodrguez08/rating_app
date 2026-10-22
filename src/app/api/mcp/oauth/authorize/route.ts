import type { NextRequest } from "next/server";

import { getMessages } from "@/i18n/messages";
import {
  verifyAdminSession,
  ADMIN_SESSION_COOKIE,
} from "@/lib/server/admin-auth";
import {
  McpOAuthStore,
  MCP_READ_SCOPE,
  readMcpOAuthConfig,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
const messages = getMessages("es").mcp;

export async function GET(request: NextRequest) {
  try {
    const config = readMcpOAuthConfig();
    const parameters = request.nextUrl.searchParams;
    const redirectUri = parameters.get("redirect_uri") ?? "";
    const state = parameters.get("state") ?? "";
    const codeChallenge = parameters.get("code_challenge") ?? "";
    if (
      parameters.get("response_type") !== "code" ||
      parameters.get("client_id") !== config.clientId ||
      !config.redirectUris.has(redirectUri) ||
      parameters.get("resource") !== config.resource ||
      parameters.get("scope") !== MCP_READ_SCOPE ||
      parameters.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
      state.length < 8 ||
      state.length > 500
    ) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const owner = await verifyAdminSession(
      request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    );
    const code = await new McpOAuthStore().issueAuthorizationCode({
      ownerId: owner.uid,
      clientId: config.clientId,
      redirectUri,
      resource: config.resource,
      scope: MCP_READ_SCOPE,
      codeChallenge,
    });
    const destination = new URL(redirectUri);
    destination.searchParams.set("code", code);
    destination.searchParams.set("state", state);
    return Response.redirect(destination, 302);
  } catch (error) {
    const status =
      error instanceof Error && error.name === "AdminAuthorizationError"
        ? 401
        : 503;
    return new Response(
      status === 401 ? messages.authorizeSignIn : messages.authorizeFailure,
      {
        status,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }
}
