import type { TeamPresentation } from "@/domain/models";
import initialTeam from "../../firebase/seed/initial-team.json";
import saprissaTeam from "../../firebase/seed/saprissa-team.json";

export type ClubSlug = "herediano" | "saprissa";

export interface Club extends TeamPresentation {
  slug: ClubSlug;
  brandingKey: string;
  publicAvailability: "active" | "coming_soon";
}

export const clubs: Readonly<Record<ClubSlug, Club>> = {
  herediano: {
    slug: "herediano",
    teamId: initialTeam.id,
    displayName: initialTeam.displayName,
    shortName: initialTeam.shortName,
    brandingKey: initialTeam.brandingKey,
    theme: { primary: "#b20d24", accent: "#f5c518" },
    publicAvailability: "active",
  },
  saprissa: {
    slug: "saprissa",
    teamId: saprissaTeam.id,
    displayName: saprissaTeam.displayName,
    shortName: saprissaTeam.shortName,
    brandingKey: saprissaTeam.brandingKey,
    theme: { primary: "#6f2c91", accent: "#ffffff" },
    publicAvailability: "coming_soon",
  },
};

export const initialClub = clubs.herediano;

export function adminPath(club: Club, path = ""): string {
  return `/admin${path}?club=${club.slug}`;
}

export function resolveClub(value: string): Club | null {
  return Object.hasOwn(clubs, value) ? clubs[value as ClubSlug] : null;
}

export function clubForTeam(teamId: string): Club | null {
  return Object.values(clubs).find((club) => club.teamId === teamId) ?? null;
}

export function adminClubForTeam(teamId: string): Club {
  const club = clubForTeam(teamId);
  if (!club) throw new Error("Unknown admin Team.");
  return club;
}

export function clubPath(club: Club, path = ""): string {
  return `/${club.slug}${path}`;
}

export function matchPath(club: Club, matchId: string, path = ""): string {
  return clubPath(club, `/matches/${encodeURIComponent(matchId)}${path}`);
}

export function playerPath(club: Club, playerId: string): string {
  return clubPath(club, `/players/${encodeURIComponent(playerId)}`);
}

export function matchApiPath(
  club: Club,
  matchId: string,
  path: string,
): string {
  return `/api/clubs/${club.slug}/matches/${encodeURIComponent(matchId)}${path}`;
}
