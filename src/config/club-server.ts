import { notFound } from "next/navigation";

import { resolveClub, type Club } from "./club";

export function requireClub(slug: string): Club {
  return resolveClub(slug) ?? notFound();
}

export function requireActiveClub(slug: string): Club {
  const club = requireClub(slug);
  if (club.publicAvailability !== "active") notFound();
  return club;
}
