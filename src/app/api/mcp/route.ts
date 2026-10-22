import type { NextRequest } from "next/server";
import { requireBearerAuth } from "@modelcontextprotocol/server";

import {
  McpOAuthStore,
  MCP_READ_SCOPE,
  readMcpOAuthConfig,
} from "@/lib/mcp/oauth";
import { createRatingMcpHandler } from "@/lib/mcp/server";
import { McpRequestRateLimiter } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createRatingMcpHandler();
const rateLimiter = new McpRequestRateLimiter();

export async function POST(request: NextRequest) {
  try {
    const config = readMcpOAuthConfig();
    if (request.nextUrl.origin !== config.origin)
      return json({ error: "invalid_request" }, 400);
    const gate = requireBearerAuth({
      verifier: new McpOAuthStore(),
      requiredScopes: [MCP_READ_SCOPE],
      expectedResource: new URL(config.resource),
      resourceMetadataUrl: `${config.origin}/.well-known/oauth-protected-resource`,
    });
    const auth = await gate(request);
    if (auth instanceof Response) return auth;
    const rate = rateLimiter.allow(auth.token);
    if (!rate.allowed) {
      const response = json({ error: "too_many_requests" }, 429);
      response.headers.set("retry-after", String(rate.retryAfter));
      return response;
    }
    return withNoStore(await handler.fetch(request, { authInfo: auth }));
  } catch {
    return json({ error: "server_error" }, 503);
  }
}

export async function GET() {
  return json({ error: "method_not_allowed" }, 405);
}

export async function DELETE() {
  return json({ error: "method_not_allowed" }, 405);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function withNoStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}
