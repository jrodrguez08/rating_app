import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { getMessages } from "@/i18n/messages";
import { McpReadService } from "@/lib/mcp/read-service";

const pagination = {
  limit: z.number().int().min(1).max(20).optional(),
  cursor: z.string().max(500).optional(),
};
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const messages = getMessages("es").mcp;

export function createRatingMcpHandler(service?: McpReadService) {
  return createMcpHandler(
    () => {
      const readService = service ?? new McpReadService();
      const server = new McpServer({ name: "rating-app", version: "1.0.0" });
      server.registerTool(
        "list_matches",
        {
          description: messages.tools.listMatches,
          inputSchema: z.object({
            kind: z.enum(["recent", "upcoming", "completed", "published"]),
            ...pagination,
          }),
          annotations,
        },
        async (input) =>
          toolResult("list_matches", () => readService.listMatches(input)),
      );
      server.registerTool(
        "get_match_results",
        {
          description: messages.tools.matchResults,
          inputSchema: z.object({ matchId: z.string().min(1).max(160) }),
          annotations,
        },
        async ({ matchId }) =>
          toolResult("get_match_results", () =>
            readService.getMatchResults(matchId),
          ),
      );
      server.registerTool(
        "search_players",
        {
          description: messages.tools.searchPlayers,
          inputSchema: z.object({
            query: z.string().max(80).default(""),
            ...pagination,
          }),
          annotations,
        },
        async (input) =>
          toolResult("search_players", () => readService.searchPlayers(input)),
      );
      server.registerTool(
        "get_player_statistics",
        {
          description: messages.tools.playerStatistics,
          inputSchema: z.object({
            playerId: z.string().min(1).max(160),
            ...pagination,
          }),
          annotations,
        },
        async (input) =>
          toolResult("get_player_statistics", () =>
            readService.getPlayerStatistics(input),
          ),
      );
      server.registerTool(
        "get_coach_statistics",
        {
          description: messages.tools.coachStatistics,
          inputSchema: z.object({
            coachId: z.string().min(1).max(160),
            ...pagination,
          }),
          annotations,
        },
        async (input) =>
          toolResult("get_coach_statistics", () =>
            readService.getCoachStatistics(input),
          ),
      );
      return server;
    },
    { responseMode: "auto", maxRequestBodySize: 64 * 1024 },
  );
}

async function toolResult(name: string, execute: () => Promise<unknown>) {
  try {
    const output = await execute();
    const structuredContent = toJsonObject(output);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(structuredContent) },
      ],
      structuredContent,
    };
  } catch (error) {
    console.error("mcp_tool_failed", {
      tool: name,
      error: error instanceof Error ? error.name : "unknown",
    });
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: messages.toolFailure,
        },
      ],
    };
  }
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("MCP tool output must be an object.");
}
