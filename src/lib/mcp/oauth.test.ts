import { describe, expect, it } from "vitest";

import { pkceChallenge, readMcpOAuthConfig, validateClient } from "./oauth";

const environment = {
  NEXT_PUBLIC_FIREBASE_ENVIRONMENT: "production",
  MCP_PUBLIC_ORIGIN: "https://ratings.example",
  MCP_OAUTH_CLIENT_ID: "chatgpt-rating-app",
  MCP_OAUTH_CLIENT_SECRET: "a".repeat(48),
  MCP_OAUTH_REDIRECT_URIS:
    "https://chatgpt.com/connector_platform_oauth_redirect",
};

describe("MCP OAuth configuration", () => {
  it("defines one HTTPS audience and exact redirect allowlist", () => {
    expect(readMcpOAuthConfig(environment)).toMatchObject({
      origin: "https://ratings.example",
      resource: "https://ratings.example/api/mcp",
      clientId: "chatgpt-rating-app",
    });
  });

  it("rejects insecure production origins and weak secrets", () => {
    expect(() =>
      readMcpOAuthConfig({
        ...environment,
        MCP_PUBLIC_ORIGIN: "http://ratings.example",
      }),
    ).toThrow();
    expect(() =>
      readMcpOAuthConfig({ ...environment, MCP_OAUTH_CLIENT_SECRET: "short" }),
    ).toThrow();
  });

  it("validates confidential clients without accepting arbitrary headers", () => {
    const config = readMcpOAuthConfig(environment);
    const credentials = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64");
    expect(
      validateClient(
        new Request("https://ratings.example", {
          headers: { authorization: `Basic ${credentials}` },
        }),
        config,
      ),
    ).toBe(true);
    expect(
      validateClient(
        new Request("https://ratings.example", {
          headers: { "x-api-key": config.clientSecret },
        }),
        config,
      ),
    ).toBe(false);
  });

  it("uses the required SHA-256 PKCE challenge", () => {
    expect(pkceChallenge("a".repeat(43))).toBe(
      "ZtNPunH49FD35FWYhT5Tv8I7vRKQJ8uxMaL0_9eHjNA",
    );
  });
});
