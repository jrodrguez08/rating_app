import { describe, expect, it } from "vitest";

import { clubs } from "./club";
import { resolveSiteUrl } from "./site";
import { buildRatingUrl, buildWhatsAppRatingShareUrl } from "./whatsapp-share";

describe("WhatsApp rating sharing", () => {
  it.each(["herediano", "saprissa"] as const)(
    "preserves %s and encoded Match identity with configured and fallback origins",
    (slug) => {
      for (const configured of [undefined, "https://ratings.example.com"]) {
        const origin = resolveSiteUrl({
          NEXT_PUBLIC_SITE_URL: configured,
          VERCEL_URL: "untrusted-preview.vercel.app",
        });
        const composer = new URL(
          buildWhatsAppRatingShareUrl(clubs[slug], "match/id ?", origin),
        );
        expect(composer.searchParams.get("text")).toContain(
          `${configured ?? "https://www.futratecr.com"}/${slug}/matches/match%2Fid%20%3F/rate`,
        );
        expect(composer.searchParams.get("text")).not.toContain("untrusted");
      }
    },
  );
  it("builds the encoded rating deep link from the canonical production origin", () => {
    const origin = resolveSiteUrl({
      VERCEL_URL: "rating-app-git-feature.vercel.app",
    });

    expect(buildRatingUrl(clubs.herediano, "match/id ?", origin).href).toBe(
      "https://www.futratecr.com/herediano/matches/match%2Fid%20%3F/rate",
    );
  });

  it("encodes the complete Spanish message and preserves its canonical URL", () => {
    const composerUrl = new URL(
      buildWhatsAppRatingShareUrl(
        clubs.herediano,
        "public-match",
        new URL("https://ratings.example.com"),
      ),
    );
    const message = composerUrl.searchParams.get("text");

    expect(composerUrl.origin).toBe("https://wa.me");
    expect(message).toBe(
      "Ya está abierta la votación del partido. Califica a los jugadores de Herediano en Rating App: https://ratings.example.com/herediano/matches/public-match/rate",
    );
    expect(decodeURIComponent(composerUrl.search.slice(6))).toBe(message);
  });

  it("contains only the public match route and static community copy", () => {
    const shareUrl = buildWhatsAppRatingShareUrl(
      clubs.herediano,
      "public-match",
    );

    for (const privateField of [
      "uid",
      "voterId",
      "ballot",
      "externalProvider",
      "fixtureId",
      "diagnostic",
    ]) {
      expect(shareUrl).not.toContain(privateField);
    }
  });
});
