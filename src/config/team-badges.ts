import type { MatchTeamSnapshot } from "@/domain/models";

export interface TeamBadgePresentation {
  abbreviation: string;
  primary: string;
  secondary: string;
  pattern: "stripe" | "band";
}

// API-Football Primera División (league 162), season 2026.
const CURATED_TEAM_BADGES: Readonly<Record<string, TeamBadgePresentation>> = {
  "815": {
    abbreviation: "CH",
    primary: "#b20d24",
    secondary: "#f5c518",
    pattern: "stripe",
  },
  "816": {
    abbreviation: "DS",
    primary: "#6f2c91",
    secondary: "#f7f2e8",
    pattern: "band",
  },
  "819": {
    abbreviation: "PZ",
    primary: "#1556a3",
    secondary: "#d4a72c",
    pattern: "stripe",
  },
  "820": {
    abbreviation: "CC",
    primary: "#174ea6",
    secondary: "#f7f2e8",
    pattern: "band",
  },
  "822": {
    abbreviation: "LDA",
    primary: "#c8102e",
    secondary: "#101113",
    pattern: "stripe",
  },
  "823": {
    abbreviation: "SC",
    primary: "#c62828",
    secondary: "#174ea6",
    pattern: "stripe",
  },
  "2045": {
    abbreviation: "PFC",
    primary: "#f58220",
    secondary: "#101113",
    pattern: "band",
  },
  "2047": {
    abbreviation: "SFC",
    primary: "#171719",
    secondary: "#c9a227",
    pattern: "band",
  },
  "17377": {
    abbreviation: "EB",
    primary: "#164fa3",
    secondary: "#f5c518",
    pattern: "stripe",
  },
  "24391": {
    abbreviation: "ISC",
    primary: "#177245",
    secondary: "#f5c518",
    pattern: "band",
  },
};

export function getTeamBadgePresentation(
  team: MatchTeamSnapshot,
): TeamBadgePresentation {
  const curated = CURATED_TEAM_BADGES[team.externalProviderId];
  if (curated) return curated;
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
