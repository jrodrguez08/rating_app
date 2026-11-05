import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";
import { AdminSecurityError } from "@/lib/firebase/admin-security";
import type * as AdminSecurityModule from "@/lib/firebase/admin-security";
import type * as AdminRequestModule from "@/lib/server/admin-request";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  authorizeAction: vi.fn(),
}));

vi.mock(
  "@/lib/server/admin-request",
  async (importOriginal: () => Promise<typeof AdminRequestModule>) => ({
    ...(await importOriginal()),
    requireAdminRequest: mocks.requireAdminRequest,
  }),
);
vi.mock("@/lib/firebase/admin-security", async (importOriginal) => {
  const actual = await importOriginal<typeof AdminSecurityModule>();
  return {
    ...actual,
    AdminSecurityStore: class {
      authorizeAction = mocks.authorizeAction;
    },
  };
});

import { POST } from "./route";

function request() {
  return new NextRequest(
    "https://rating.test/api/admin/catalog-import/authorize?club=saprissa",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: {
          trackedTeamId: "deportivo-saprissa",
          externalTeamId: "816",
          observedAt: "2026-11-04T12:00:00.000Z",
          providerRequests: 1,
          squadPlayers: 0,
          fixtures: [],
          players: [],
          coaches: [],
          stateHash: "a".repeat(64),
        },
        previewToken: "preview",
        passphrase: "synthetic passphrase",
      }),
    },
  );
}

describe("admin catalog authorization errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ uid: "owner" });
  });

  it.each([
    ["stale_preview", "previewExpired"],
    ["invalid_passphrase", "passphraseInvalid"],
  ] as const)("maps %s to a distinct safe message", async (code, copy) => {
    mocks.authorizeAction.mockRejectedValue(new AdminSecurityError(code));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code,
      error: getMessages("es").admin.catalogImport[copy],
    });
  });
});
