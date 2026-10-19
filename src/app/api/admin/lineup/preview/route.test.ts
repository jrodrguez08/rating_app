import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";
import { AdminLineupError } from "@/lib/server/admin-lineup-error";
import { AdminAuthorizationError } from "@/lib/server/admin-auth";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  issuePreview: vi.fn(),
  requireAdminRequest: vi.fn(),
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
    requireAdminRequest: mocks.requireAdminRequest,
  };
});

const action = {
  matchId: "match-10a50b08075ca1f0646e5b6d",
  trackedTeamId: "club-sport-herediano",
  externalFixtureId: "1551706",
  participants: Array.from({ length: 21 }, (_, index) =>
    index === 20
      ? {
          playerId: `player-internal-${"a".repeat(32)}`,
          playerName: "D. Gonzalez",
          createInternalIdentity: true,
          identityAllocationToken: "sensitive-allocation-token",
          squadRole: "substitute",
          participationStatus: "confirmed_substitute",
          enteredAtMinute: 78,
        }
      : {
          playerId: `player-${index + 1}`,
          playerName: `Jugador ${index + 1}`,
          createInternalIdentity: false,
          squadRole: index < 11 ? "starter" : "substitute",
          participationStatus:
            index < 11
              ? "confirmed_starter"
              : index < 15
                ? "confirmed_substitute"
                : "unused_substitute",
          ...(index >= 11 && index < 15 ? { enteredAtMinute: 50 + index } : {}),
        },
  ),
  verificationSource: "https://example.com/fixture-1551706",
  verificationReason: "Fixture-specific operator evidence.",
};

beforeEach(() => {
  mocks.preview.mockReset();
  mocks.issuePreview.mockReset();
  mocks.requireAdminRequest.mockReset();
  mocks.requireAdminRequest.mockResolvedValue({ uid: "owner-uid" });
  mocks.issuePreview.mockResolvedValue({
    token: "preview-token",
    expiresAt: "2026-10-19T12:00:00.000Z",
  });
});

describe("admin verified lineup preview route", () => {
  it("rejects an unauthorized request before parsing or reading lineup data", async () => {
    mocks.requireAdminRequest.mockRejectedValue(
      new AdminAuthorizationError(401),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.issuePreview).not.toHaveBeenCalled();
  });

  it("accepts the reported 11 starter, five entrant, five unused structure", async () => {
    mocks.preview.mockResolvedValue({
      matchId: action.matchId,
      participantCreates: 21,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith({
      ...action,
      operatorId: "owner-uid",
    });
    expect(mocks.issuePreview).toHaveBeenCalledWith("owner-uid", action);
  });

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

  it("identifies the missing provider Team field in Spanish", async () => {
    mocks.preview.mockRejectedValue(
      new AdminLineupError(
        "LINEUP_TRACKED_TEAM_PROVIDER_ID_MISSING",
        "internal detail",
      ),
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "LINEUP_TRACKED_TEAM_PROVIDER_ID_MISSING",
      error: "Falta la identidad de proveedor del equipo seleccionado.",
    });
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
