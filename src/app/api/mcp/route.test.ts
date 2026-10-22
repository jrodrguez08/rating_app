import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ENVIRONMENT", "production");
  vi.stubEnv("MCP_PUBLIC_ORIGIN", "https://ratings.example");
  vi.stubEnv("MCP_OAUTH_CLIENT_ID", "chatgpt");
  vi.stubEnv("MCP_OAUTH_CLIENT_SECRET", "s".repeat(48));
  vi.stubEnv(
    "MCP_OAUTH_REDIRECT_URIS",
    "https://chatgpt.com/connector_platform_oauth_redirect",
  );
});

afterEach(() => vi.unstubAllEnvs());

describe("MCP HTTP authorization boundary", () => {
  it("challenges unauthenticated requests before any tool can execute", async () => {
    const response = await POST(
      new NextRequest("https://ratings.example/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(response.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource",
    );
  });

  it("rejects session-style GET requests on the stateless endpoint", async () => {
    await expect(GET()).resolves.toMatchObject({ status: 405 });
  });
});
