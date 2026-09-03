import { describe, expect, it } from "vitest";

import { resolveSiteUrl } from "./site";
import { buildRatingUrl, buildWhatsAppRatingShareUrl } from "./whatsapp-share";

describe("WhatsApp rating sharing", () => {
  it("builds the encoded rating deep link from the canonical production origin", () => {
    const origin = resolveSiteUrl({
      VERCEL_URL: "rating-app-git-feature.vercel.app",
    });

    expect(buildRatingUrl("match/id ?", origin).href).toBe(
      "https://rating-app-amber.vercel.app/matches/match%2Fid%20%3F/rate",
    );
  });

  it("encodes the complete Spanish message and preserves its canonical URL", () => {
    const composerUrl = new URL(
      buildWhatsAppRatingShareUrl(
        "public-match",
        new URL("https://ratings.example.com"),
      ),
    );
    const message = composerUrl.searchParams.get("text");

    expect(composerUrl.origin).toBe("https://wa.me");
    expect(message).toBe(
      "Ya está abierta la votación del partido. Califica a los jugadores del Herediano en Rating App: https://ratings.example.com/matches/public-match/rate",
    );
    expect(decodeURIComponent(composerUrl.search.slice(6))).toBe(message);
  });

  it("contains only the public match route and static community copy", () => {
    const shareUrl = buildWhatsAppRatingShareUrl("public-match");

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
