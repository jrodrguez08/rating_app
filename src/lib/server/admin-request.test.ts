import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { clubs } from "@/config/club";

import { requireAdminActionClub, requireAdminClub } from "./admin-request";

describe("admin club context", () => {
  it("requires exactly one registered club on protected endpoints", () => {
    for (const query of [
      "",
      "?club=unknown",
      "?club=herediano&club=saprissa",
      "?club=",
    ]) {
      expect(() =>
        requireAdminClub(
          new NextRequest(`https://rating.test/api/admin/overview${query}`),
        ),
      ).toThrow();
    }
    expect(
      requireAdminClub(
        new NextRequest("https://rating.test/api/admin/overview?club=saprissa"),
      ),
    ).toEqual(clubs.saprissa);
  });

  it("rejects either direction of a conflicting action Team", () => {
    for (const [slug, teamId] of [
      ["saprissa", clubs.herediano.teamId],
      ["herediano", clubs.saprissa.teamId],
    ] as const) {
      expect(() =>
        requireAdminActionClub(
          new NextRequest(
            `https://rating.test/api/admin/lineup/preview?club=${slug}`,
          ),
          teamId,
        ),
      ).toThrow();
    }
    expect(
      requireAdminActionClub(
        new NextRequest(
          "https://rating.test/api/admin/lineup/preview?club=saprissa",
        ),
        clubs.saprissa.teamId,
      ),
    ).toEqual(clubs.saprissa);
  });
});
