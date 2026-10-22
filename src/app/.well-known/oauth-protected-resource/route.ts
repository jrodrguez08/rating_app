import { MCP_READ_SCOPE, readMcpOAuthConfig } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = readMcpOAuthConfig();
    return Response.json(
      {
        resource: config.resource,
        authorization_servers: [config.origin],
        scopes_supported: [MCP_READ_SCOPE],
        bearer_methods_supported: ["header"],
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "server_error" }, { status: 503 });
  }
}
