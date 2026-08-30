import type { MatchTeamSnapshot } from "@/domain/models";

export interface TeamBadgePresentation {
  abbreviation: string;
  primary: string;
  secondary: string;
  pattern: "stripe" | "band";
}

const HEREDIANO_BADGE: TeamBadgePresentation = {
  abbreviation: "CH",
  primary: "#b20d24",
  secondary: "#f5c518",
  pattern: "stripe",
};

const CARTAGINES_BADGE: TeamBadgePresentation = {
  abbreviation: "CC",
  primary: "#174ea6",
  secondary: "#f7f2e8",
  pattern: "band",
};

export function getTeamBadgePresentation(
  team: MatchTeamSnapshot,
): TeamBadgePresentation {
  if (team.externalProviderId === "815") return HEREDIANO_BADGE;
  if (team.externalProviderId === "820") return CARTAGINES_BADGE;
  return {
    abbreviation: abbreviation(team.name),
    primary: "#363a40",
    secondary: "#d5d0c7",
    pattern: "stripe",
  };
}

function abbreviation(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "FC";
}
