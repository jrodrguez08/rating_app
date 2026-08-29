import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasSubmitted: vi.fn(),
  submit: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@/lib/firebase/server", () => ({
  AdminBallotService: class {
    hasSubmitted = mocks.hasSubmitted;
    submit = mocks.submit;
  },
}));
vi.mock("@/lib/server/voter-token", () => ({
  verifyVoterRequest: mocks.verify,
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ matchId: "match-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue("trusted-voter");
  mocks.hasSubmitted.mockResolvedValue(false);
  mocks.submit.mockResolvedValue({ status: "created" });
});

describe("ballot API", () => {
  it("rejects missing or invalid authentication before reading a ballot", async () => {
    mocks.verify.mockResolvedValue(null);
    const response = await GET(new Request("http://local/api"), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ status: "unauthorized" });
    expect(mocks.hasSubmitted).not.toHaveBeenCalled();
  });

  it("reports the current verified voter's submission state", async () => {
    mocks.hasSubmitted.mockResolvedValue(true);
    const response = await GET(
      new Request("http://local/api", {
        headers: { Authorization: "Bearer token" },
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "submitted" });
    expect(mocks.hasSubmitted).toHaveBeenCalledWith("match-1", "trusted-voter");
  });

  it("derives the ballot owner from the verified token", async () => {
    const ratings = {
      playerRatings: { player: 8 },
      coachRating: { coachId: "coach", rating: 9 },
      voterId: "spoofed-voter",
    };
    const response = await POST(
      new Request("http://local/api", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ratings),
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(mocks.submit).toHaveBeenCalledWith(
      "match-1",
      "trusted-voter",
      ratings,
    );
  });

  it.each([
    ["already_submitted", 409],
    ["invalid_ballot", 400],
    ["data_unavailable", 503],
    ["not_open", 403],
    ["closed", 403],
  ])("maps %s to HTTP %s", async (status, expectedStatus) => {
    mocks.submit.mockResolvedValue({ status });
    const response = await POST(
      new Request("http://local/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      context,
    );

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({ status });
  });

  it("fails closed for malformed JSON and persistence failures", async () => {
    const malformed = await POST(
      new Request("http://local/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      context,
    );
    expect(malformed.status).toBe(400);

    mocks.hasSubmitted.mockRejectedValue(new Error("database unavailable"));
    const unavailable = await GET(new Request("http://local/api"), context);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      status: "data_unavailable",
    });
  });

  it("rejects unsupported media, oversized payloads, and invalid match IDs", async () => {
    const unsupported = await POST(
      new Request("http://local/api", { method: "POST", body: "{}" }),
      context,
    );
    expect(unsupported.status).toBe(415);

    const oversized = await POST(
      new Request("http://local/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(17 * 1024) }),
      }),
      context,
    );
    expect(oversized.status).toBe(413);

    const invalidContext = { params: Promise.resolve({ matchId: "../bad" }) };
    const invalid = await GET(new Request("http://local/api"), invalidContext);
    expect(invalid.status).toBe(400);
    expect(mocks.hasSubmitted).not.toHaveBeenCalled();
  });

  it("marks every API response as non-cacheable", async () => {
    const response = await GET(new Request("http://local/api"), context);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
