import { notFound } from "next/navigation";

import { resolveClub, type Club } from "./club";
import { publicClub } from "./club-operations";

export function requireClub(slug: string): Club {
  const club = resolveClub(slug) ?? notFound();
  return publicClub(club.slug);
}

export function requireActiveClub(slug: string): Club {
  const club = requireClub(slug);
  if (club.publicAvailability !== "active") notFound();
  return club;
}
