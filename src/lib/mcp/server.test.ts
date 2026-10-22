import { describe, expect, it, vi } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import type { McpReadService } from "./read-service";
import { createRatingMcpHandler } from "./server";

describe("Rating App MCP protocol", () => {
  it("initializes and discovers only the five read-only tools", async () => {
    const handler = createRatingMcpHandler(mockService());
    const transport = new StreamableHTTPClientTransport(
      new URL("https://ratings.example/api/mcp"),
      {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      },
    );
    const client = new Client({ name: "mcp-test", version: "1" });
    await client.connect(transport);
    const discovered = await client.listTools();
    expect(discovered.tools.map((tool) => tool.name)).toEqual([
      "list_matches",
      "get_match_results",
      "search_players",
      "get_player_statistics",
      "get_coach_statistics",
    ]);
    for (const tool of discovered.tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
    await client.close();
  });

  it("validates tool input and returns compact structured content", async () => {
    const service = mockService();
    const handler = createRatingMcpHandler(service);
    const called = await rpc(handler, "tools/call", {
      name: "get_match_results",
      arguments: { matchId: "match-1" },
    });
    expect(service.getMatchResults).toHaveBeenCalledWith("match-1");
    expect(called.result.structuredContent).toEqual({
      availability: "published",
    });
    const invalid = await rpc(handler, "tools/call", {
      name: "get_match_results",
      arguments: { matchId: "" },
    });
    expect(invalid.result.isError).toBe(true);
  });

  it("returns a safe tool error when a read dependency fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = mockService();
    vi.mocked(service.getMatchResults).mockRejectedValueOnce(
      new Error("private backend detail"),
    );
    const failed = await rpc(createRatingMcpHandler(service), "tools/call", {
      name: "get_match_results",
      arguments: { matchId: "match-1" },
    });
    expect(failed.result).toMatchObject({ isError: true });
    expect(JSON.stringify(failed)).not.toContain("private backend detail");
    expect(log).toHaveBeenCalledWith("mcp_tool_failed", {
      tool: "get_match_results",
      error: "Error",
    });
    log.mockRestore();
  });
});

function mockService(): McpReadService {
  return {
    listMatches: vi.fn(async () => ({ matches: [] })),
    getMatchResults: vi.fn(async () => ({ availability: "published" })),
    searchPlayers: vi.fn(async () => ({ players: [] })),
    getPlayerStatistics: vi.fn(async () => ({ availability: "not_found" })),
    getCoachStatistics: vi.fn(async () => ({ availability: "not_found" })),
  } as unknown as McpReadService;
}

async function rpc(
  handler: ReturnType<typeof createRatingMcpHandler>,
  method: string,
  params: object,
) {
  const response = await handler.fetch(
    new Request("https://ratings.example/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.text();
  const data = body
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return JSON.parse(data ?? body);
}
