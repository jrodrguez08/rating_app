import { siteUrl } from "./site";

const WHATSAPP_COMPOSER_URL = "https://wa.me/";

export function buildRatingUrl(matchId: string, origin: URL = siteUrl): URL {
  return new URL(`/matches/${encodeURIComponent(matchId)}/rate`, origin);
}

export function buildWhatsAppRatingShareUrl(
  matchId: string,
  origin: URL = siteUrl,
): string {
  const ratingUrl = buildRatingUrl(matchId, origin).href;
  const message =
    "Ya está abierta la votación del partido. " +
    `Califica a los jugadores del Herediano en Rating App: ${ratingUrl}`;

  return `${WHATSAPP_COMPOSER_URL}?text=${encodeURIComponent(message)}`;
}
