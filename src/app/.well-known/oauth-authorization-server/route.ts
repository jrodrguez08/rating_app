import { MCP_READ_SCOPE, readMcpOAuthConfig } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = readMcpOAuthConfig();
    return Response.json(
      {
        issuer: config.origin,
        authorization_endpoint: `${config.origin}/api/mcp/oauth/authorize`,
        token_endpoint: `${config.origin}/api/mcp/oauth/token`,
        revocation_endpoint: `${config.origin}/api/mcp/oauth/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
        scopes_supported: [MCP_READ_SCOPE],
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "server_error" }, { status: 503 });
  }
}
