import { describe, expect, it } from "vitest";

import { isAuthorizedCronRequest } from "./cron-auth";

describe("lifecycle endpoint authorization", () => {
  it("rejects missing and incorrect credentials", () => {
    expect(isAuthorizedCronRequest(null, "correct-secret")).toBe(false);
    expect(
      isAuthorizedCronRequest("Bearer incorrect-secret", "correct-secret"),
    ).toBe(false);
  });

  it("accepts the exact bearer secret without returning it", () => {
    expect(
      isAuthorizedCronRequest("Bearer correct-secret", "correct-secret"),
    ).toBe(true);
    expect(isAuthorizedCronRequest("Bearer anything", "")).toBe(false);
  });
});
