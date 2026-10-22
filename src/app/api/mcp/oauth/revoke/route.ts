import type { NextRequest } from "next/server";

import {
  McpOAuthStore,
  readMcpOAuthConfig,
  validateClient,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const config = readMcpOAuthConfig();
    if (!validateClient(request, config))
      return Response.json({ error: "invalid_client" }, { status: 401 });
    const form = await request.formData();
    const token = form.get("token");
    if (typeof token === "string" && token.length <= 2_000) {
      await new McpOAuthStore().revoke(token, config.clientId);
    }
    return new Response(null, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "server_error" }, { status: 503 });
  }
}
