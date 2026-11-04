import { describe, expect, it } from "vitest";

import { buildPageMetadata, resolveSiteUrl, siteIdentity } from "./site";

describe("canonical site URL", () => {
  it("uses the explicit production origin without following a preview host", () => {
    expect(
      resolveSiteUrl({ VERCEL_URL: "rating-app-git-feature.vercel.app" }).href,
    ).toBe("https://rating-app-amber.vercel.app/");
  });

  it("supports a future custom domain through one configured value", () => {
    expect(
      resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://ratings.example.com" })
        .href,
    ).toBe("https://ratings.example.com/");
  });

  it.each([
    "http://rating-app.example.com",
    "https://rating-app.example.com/path",
    "https://user:password@rating-app.example.com",
  ])("rejects an unsafe canonical origin: %s", (value) => {
    expect(() => resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: value })).toThrow(
      /HTTPS origin/,
    );
  });
});

describe("club-scoped metadata", () => {
  it("keeps root branding neutral and distinguishes the same subroute by club", () => {
    expect(buildPageMetadata("/").title).toBe(siteIdentity.name);
    const herediano = buildPageMetadata("/herediano/players", {
      title: "Jugadores",
    });
    const saprissa = buildPageMetadata("/saprissa/players", {
      title: "Jugadores",
    });
    expect(herediano.title).toBe("Jugadores | Club Sport Herediano");
    expect(saprissa.title).toBe("Jugadores | Deportivo Saprissa");
    expect(herediano.openGraph?.url).toBe("/herediano/players");
    expect(saprissa.openGraph?.url).toBe("/saprissa/players");
    expect(herediano.openGraph?.images).not.toEqual(saprissa.openGraph?.images);
  });
});
