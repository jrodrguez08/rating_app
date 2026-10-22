import { describe, expect, it } from "vitest";

import { McpRequestRateLimiter } from "./rate-limit";

describe("MCP request rate limit", () => {
  it("bounds each access grant per minute without persistence writes", () => {
    const limiter = new McpRequestRateLimiter();
    for (let index = 0; index < 30; index += 1)
      expect(limiter.allow("grant", 1_000)).toEqual({ allowed: true });
    expect(limiter.allow("grant", 1_000)).toEqual({
      allowed: false,
      retryAfter: 60,
    });
    expect(limiter.allow("grant", 61_000)).toEqual({ allowed: true });
  });
});
