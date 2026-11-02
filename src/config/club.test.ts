import { describe, expect, it } from "vitest";

import { clubPath, clubs, matchPath, playerPath, resolveClub } from "./club";

describe("club registry and public routes", () => {
  it("resolves only the two declared clubs with distinct stable Team IDs and themes", () => {
    expect(resolveClub("herediano")).toEqual(clubs.herediano);
    expect(resolveClub("saprissa")).toEqual(clubs.saprissa);
    expect(resolveClub("unknown")).toBeNull();
    expect(resolveClub("matches")).toBeNull();
    expect(clubs.herediano).toMatchObject({
      teamId: "club-sport-herediano",
      brandingKey: "herediano",
      theme: { primary: "#b20d24", accent: "#f5c518" },
      publicAvailability: "active",
    });
    expect(clubs.saprissa).toMatchObject({
      teamId: "deportivo-saprissa",
      brandingKey: "saprissa",
      theme: { primary: "#6f2c91", accent: "#ffffff" },
      publicAvailability: "coming_soon",
    });
  });

  it("constructs encoded club-scoped links without an implicit default", () => {
    expect(clubPath(clubs.saprissa, "/studio")).toBe("/saprissa/studio");
    expect(matchPath(clubs.herediano, "fixture/id", "/results")).toBe(
      "/herediano/matches/fixture%2Fid/results",
    );
    expect(playerPath(clubs.saprissa, "player/id")).toBe(
      "/saprissa/players/player%2Fid",
    );
  });
});
