import { describe, expect, it } from "vitest";

import { getTeamBadgePresentation } from "./team-badges";

describe("team badge presentation", () => {
  it("maps Herediano by stable provider identity", () => {
    expect(
      getTeamBadgePresentation({
        externalProviderId: "815",
        name: "A provider name change",
      }),
    ).toEqual({
      abbreviation: "CH",
      primary: "#b20d24",
      secondary: "#f5c518",
      pattern: "stripe",
    });
  });

  it("maps Cartagin\u00e9s by stable provider identity despite a name change", () => {
    expect(
      getTeamBadgePresentation({
        externalProviderId: "820",
        name: "A renamed Cartagin\u00e9s display",
      }),
    ).toEqual({
      abbreviation: "CC",
      primary: "#174ea6",
      secondary: "#f7f2e8",
      pattern: "band",
    });
  });

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
