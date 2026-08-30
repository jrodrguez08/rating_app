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

  it("maps the current Cartagin\u00e9s fixture by an exact provider name", () => {
    expect(
      getTeamBadgePresentation({
        externalProviderId: "cartagines-provider-id",
        name: "CS Cartagin\u00e9s",
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
