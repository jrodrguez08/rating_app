import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  getVoteComparison: vi.fn(),
}));
vi.mock("@/lib/server/voter-token", () => ({
  verifyVoterRequest: mocks.verify,
}));
vi.mock("@/lib/firebase/server", () => ({
  AdminResultService: class {
    getVoteComparison = mocks.getVoteComparison;
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ matchId: "match-1" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue("voter-a");
});

describe("vote comparison API", () => {
  it("requires a verified voter before reading anything", async () => {
    mocks.verify.mockResolvedValue(null);
    const response = await GET(new Request("http://local/api"), context);
    expect(response.status).toBe(401);
    expect(mocks.getVoteComparison).not.toHaveBeenCalled();
  });

  it("hides comparison before publication and returns only a neutral empty state without a ballot", async () => {
    mocks.getVoteComparison
      .mockResolvedValueOnce({ status: "locked" })
      .mockResolvedValueOnce({ status: "no_ballot" });
    const locked = await GET(new Request("http://local/api"), context);
    expect(locked.status).toBe(403);
    await expect(locked.json()).resolves.toEqual({ status: "locked" });
    const empty = await GET(new Request("http://local/api"), context);
    await expect(empty.json()).resolves.toEqual({ status: "no_ballot" });
  });

  it("reads only the verified voter's comparison with private no-store caching", async () => {
    mocks.getVoteComparison.mockResolvedValue({
      status: "ready",
      comparison: { players: [], coach: {} },
    });
    const response = await GET(new Request("http://local/api"), context);
    expect(mocks.getVoteComparison).toHaveBeenCalledWith("match-1", "voter-a");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.status).toBe(200);
  });
});
