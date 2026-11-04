import { matchPath, type Club } from "./club";
import { siteUrl } from "./site";

const WHATSAPP_COMPOSER_URL = "https://wa.me/";

export function buildRatingUrl(
  club: Club,
  matchId: string,
  origin: URL = siteUrl,
): URL {
  return new URL(matchPath(club, matchId, "/rate"), origin);
}

export function buildWhatsAppRatingShareUrl(
  club: Club,
  matchId: string,
  origin: URL = siteUrl,
): string {
  const ratingUrl = buildRatingUrl(club, matchId, origin).href;
  const message =
    "Ya está abierta la votación del partido. " +
    `Califica a los jugadores de ${club.shortName} en Rating App: ${ratingUrl}`;

  return `${WHATSAPP_COMPOSER_URL}?text=${encodeURIComponent(message)}`;
}
