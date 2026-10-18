import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRequestModule from "@/lib/server/admin-request";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("@/lib/firebase/admin-lineup-draft", () => ({
  AdminLineupDraftService: class {
    save = mocks.save;
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
  matchId: "match-draft-route",
  trackedTeamId: "club-sport-herediano",
  externalFixtureId: "fixture-draft-route",
  baseVersion: 0,
  participants: [
    {
      playerId: "player-1",
      playerName: "Jugador Uno",
      createInternalIdentity: false,
      squadRole: "starter",
      participationStatus: "confirmed_starter",
    },
  ],
};

beforeEach(() => mocks.save.mockReset());

describe("admin lineup draft route", () => {
  it("binds a draft to the authenticated owner without a passphrase", async () => {
    mocks.save.mockResolvedValue({
      version: 1,
      updatedAt: "2026-10-18T20:00:00.000Z",
      disposition: "committed",
    });

    const response = await POST(request(action));

    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({
      ...action,
      ownerId: "owner-uid",
    });
  });

  it("rejects a different Team before persistence", async () => {
    const response = await POST(
      request({ ...action, trackedTeamId: "opponent-team" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

function request(body: unknown) {
  const csrf = "a".repeat(43);
  return new NextRequest("http://localhost:3000/api/admin/lineup-draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `rating_admin_csrf=${csrf}`,
      Origin: "http://localhost:3000",
      "X-Admin-CSRF": csrf,
    },
    body: JSON.stringify(body),
  });
}
