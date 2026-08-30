import { describe, expect, it } from "vitest";

import { getTeamBadgePresentation } from "./team-badges";

describe("team badge presentation", () => {
  it.each([
    ["CS Herediano", "815", "CH", "#b20d24", "#f5c518", "stripe"],
    ["Deportivo Saprissa", "816", "DS", "#6f2c91", "#f7f2e8", "band"],
    ["Pérez Zeledón", "819", "PZ", "#1556a3", "#d4a72c", "stripe"],
    ["CS Cartaginés", "820", "CC", "#174ea6", "#f7f2e8", "band"],
    ["LD Alajuelense", "822", "LDA", "#c8102e", "#101113", "stripe"],
    ["San Carlos", "823", "SC", "#c62828", "#174ea6", "stripe"],
    ["Puntarenas FC", "2045", "PFC", "#f58220", "#101113", "band"],
    ["Sporting San José", "2047", "SFC", "#171719", "#c9a227", "band"],
    ["Escorpiones Belén", "17377", "EB", "#164fa3", "#f5c518", "stripe"],
    ["Inter San Carlos", "24391", "ISC", "#177245", "#f5c518", "band"],
  ] as const)(
    "maps %s by stable provider ID %s",
    (_team, id, abbreviation, primary, secondary, pattern) => {
      expect(
        getTeamBadgePresentation({
          externalProviderId: id,
          name: `Changed provider display ${id}`,
        }),
      ).toEqual({ abbreviation, primary, secondary, pattern });
    },
  );

  it("creates a neutral shield fallback for an unknown opponent", () => {
    expect(
      getTeamBadgePresentation({
        externalProviderId: "unknown",
        name: "Opponent Football Club",
      }),
    ).toEqual({
      abbreviation: "OF",
      primary: "#363a40",
      secondary: "#d5d0c7",
      pattern: "stripe",
    });
  });
});
