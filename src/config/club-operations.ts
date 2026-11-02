import { clubs, resolveClub, type Club, type ClubSlug } from "@/config/club";

type Environment = Readonly<Record<string, string | undefined>>;

function enabled(value: string | undefined): boolean {
  return value === "true";
}

export function isScheduledClubEnabled(
  slug: ClubSlug,
  environment: Environment = process.env,
): boolean {
  return (
    slug === "herediano" || enabled(environment.SAPRISSA_SCHEDULED_ENABLED)
  );
}

export function publicClub(
  slug: ClubSlug,
  environment: Environment = process.env,
): Club {
  const club = clubs[slug];
  return slug === "saprissa" && enabled(environment.SAPRISSA_PUBLIC_ENABLED)
    ? { ...club, publicAvailability: "active" }
    : club;
}

export function scheduledClubFromRequest(
  request: Request,
  environment: Environment = process.env,
): { status: "enabled" | "disabled"; club: Club } | { status: "invalid" } {
  const parameters = new URL(request.url).searchParams;
  const values = parameters.getAll("club");
  if (parameters.size > values.length || values.length > 1) {
    return { status: "invalid" };
  }
  const club = resolveClub(values[0] ?? "herediano");
  if (club === null) return { status: "invalid" };
  return {
    status: isScheduledClubEnabled(club.slug, environment)
      ? "enabled"
      : "disabled",
    club,
  };
}
