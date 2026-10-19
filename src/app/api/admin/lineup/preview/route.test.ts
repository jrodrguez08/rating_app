import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";
import { AdminLineupError } from "@/lib/server/admin-lineup-error";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  issuePreview: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-lineup", () => ({
  AdminVerifiedLineupService: class {
    preview = mocks.preview;
  },
}));

vi.mock("@/lib/firebase/admin-security", () => ({
  AdminSecurityStore: class {
    issuePreview = mocks.issuePreview;
  },
}));

vi.mock("@/lib/server/admin-request", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminRequestModule>();
  return {
    ...actual,
    requireAdminRequest: vi.fn().mockResolvedValue({ uid: "owner-uid" }),
  };
});

const action = {
  matchId: "match-10a50b08075ca1f0646e5b6d",
  trackedTeamId: "club-sport-herediano",
  externalFixtureId: "1551706",
  participants: Array.from({ length: 11 }, (_, index) =>
    index === 10
      ? {
          playerId: `player-internal-${"a".repeat(32)}`,
          playerName: "D. Gonzalez",
          createInternalIdentity: true,
          identityAllocationToken: "sensitive-allocation-token",
          squadRole: "starter",
          participationStatus: "confirmed_starter",
        }
      : {
          playerId: `player-${index + 1}`,
          playerName: `Jugador ${index + 1}`,
          createInternalIdentity: false,
          squadRole: "starter",
          participationStatus: "confirmed_starter",
        },
  ),
  verificationSource: "https://example.com/fixture-1551706",
  verificationReason: "Fixture-specific operator evidence.",
};

beforeEach(() => {
  mocks.preview.mockReset();
  mocks.issuePreview.mockReset();
  mocks.issuePreview.mockResolvedValue({
    token: "preview-token",
    expiresAt: "2026-10-19T12:00:00.000Z",
  });
});

describe("admin verified lineup preview route", () => {
  it("returns a stable actionable conflict without exposing internal details", async () => {
    mocks.preview.mockRejectedValue(
      new AdminLineupError(
        "LINEUP_PLAYER_NAME_CONFLICT",
        "sensitive internal detail",
        "D. Gonzalez",
      ),
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "LINEUP_PLAYER_NAME_CONFLICT",
      error: expect.stringContaining("D. Gonzalez"),
      requestId: expect.any(String),
    });
    expect(body.error).not.toContain("sensitive internal detail");
    expect(response.headers.get("X-Request-ID")).toBe(body.requestId);
  });

  it("returns 500 and a correlation ID for an unexpected failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.preview.mockRejectedValue(new Error("secret provider payload"));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      code: "LINEUP_PREVIEW_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "secret provider payload",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "sensitive-allocation-token",
    );
    expect(JSON.stringify(body)).not.toContain("sensitive-allocation-token");
    expect(JSON.stringify(log.mock.calls)).toContain(action.matchId);
    log.mockRestore();
  });
});

function request() {
  return new NextRequest("http://localhost:3000/api/admin/lineup/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
}
