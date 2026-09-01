import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { siteIdentity } from "@/config/site";

vi.mock("next/font/google", () => ({
  DotGothic16: () => ({ variable: "font-dot-gothic-test" }),
}));
vi.mock("@/lib/firebase/server", () => ({
  AdminMatchArchiveService: vi.fn(() => {
    throw new Error("metadata must not access Firebase");
  }),
  AdminPlayerHistoryService: vi.fn(() => {
    throw new Error("metadata must not access Firebase");
  }),
  AdminResultService: vi.fn(() => {
    throw new Error("metadata must not access Firebase");
  }),
}));

import AppleIcon, { size as appleIconSize } from "./apple-icon";
import { generateMetadata, viewport } from "./layout";
import manifest from "./manifest";
import { metadata as matchesMetadata } from "./matches/page";
import { generateMetadata as generateMatchMetadata } from "./matches/[matchId]/page";
import { generateMetadata as generateResultMetadata } from "./matches/[matchId]/results/page";
import { metadata as playersMetadata } from "./players/page";
import { generateMetadata as generatePlayerMetadata } from "./players/[playerId]/page";
import {
  GET as getSocialCard,
  socialImageAlt,
  socialImageSize,
} from "./social-card/route";

describe("public app identity metadata", () => {
  it("publishes canonical Spanish root, Open Graph, and Twitter metadata", () => {
    const metadata = generateMetadata();
    const metadataBase = metadata.metadataBase as URL;
    const openGraph = metadata.openGraph!;
    const twitter = metadata.twitter!;
    const image = Array.isArray(openGraph.images)
      ? openGraph.images[0]
      : openGraph.images;
    const imageDefinition =
      typeof image === "string" || image instanceof URL
        ? { url: image }
        : image!;

    expect(metadataBase.href).toBe("https://rating-app-amber.vercel.app/");
    expect(metadata.title).toMatchObject({ default: "Rating App" });
    expect(metadata.description).toContain("afición");
    expect(
      new URL(metadata.alternates!.canonical as string, metadataBase).href,
    ).toBe(metadataBase.href);
    expect(openGraph).toMatchObject({
      title: "Rating App",
      description: siteIdentity.socialDescription,
      siteName: "Rating App",
      type: "website",
      locale: "es_CR",
    });
    expect(new URL(openGraph.url as string, metadataBase).href).toBe(
      metadataBase.href,
    );
    expect(imageDefinition).toMatchObject({
      width: 1200,
      height: 630,
      alt: siteIdentity.socialImageAlt,
    });
    expect(new URL(imageDefinition.url, metadataBase).href).toBe(
      "https://rating-app-amber.vercel.app/social-card",
    );
    expect(twitter).toMatchObject({
      card: "summary_large_image",
      title: "Rating App",
      description: siteIdentity.socialDescription,
      images: ["/social-card"],
    });
  });

  it.each([
    ["Partidos", "/matches", matchesMetadata],
    ["Jugadores", "/players", playersMetadata],
  ])(
    "publishes the %s page with its own canonical and complete Open Graph identity",
    (title, pathname, pageMetadata) => {
      const rootMetadata = generateMetadata();
      const resolvedMetadata = { ...rootMetadata, ...pageMetadata };
      const metadataBase = resolvedMetadata.metadataBase as URL;

      expect(
        new URL(pageMetadata.alternates!.canonical as string, metadataBase)
          .pathname,
      ).toBe(pathname);
      expect(
        new URL(pageMetadata.openGraph!.url as string, metadataBase).pathname,
      ).toBe(pathname);
      expect(pageMetadata.openGraph).toMatchObject({
        title,
        siteName: "Rating App",
        type: "website",
        locale: "es_CR",
        images: [
          {
            url: "/social-card",
            width: 1200,
            height: 630,
            alt: siteIdentity.socialImageAlt,
          },
        ],
      });
      expect(resolvedMetadata.twitter).toMatchObject({
        card: "summary_large_image",
        images: ["/social-card"],
      });
    },
  );

  it("builds dynamic route identity from params without metadata data access", async () => {
    const cases = [
      [generateMatchMetadata, "fixture/id", "/matches/fixture%2Fid"],
      [generateResultMetadata, "fixture/id", "/matches/fixture%2Fid/results"],
      [generatePlayerMetadata, "player/id", "/players/player%2Fid"],
    ] as const;

    for (const [generate, id, pathname] of cases) {
      const pageMetadata = await generate({
        params: Promise.resolve(
          pathname.startsWith("/players") ? { playerId: id } : { matchId: id },
        ),
      } as never);

      expect(pageMetadata.alternates!.canonical).toBe(pathname);
      expect(pageMetadata.openGraph).toMatchObject({
        url: pathname,
        siteName: "Rating App",
        images: [{ url: "/social-card" }],
      });
    }
  });

  it("wires the browser icon, Apple touch icon, manifest, and dark browser theme", () => {
    const metadata = generateMetadata();
    expect(metadata.icons).toMatchObject({
      icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
      apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }],
    });
    expect(metadata.manifest).toBe("/manifest.webmanifest");
    expect(viewport).toEqual({ themeColor: "#101113", colorScheme: "dark" });
    expect(readFileSync("src/app/icon.svg", "utf8")).toContain("#b20d24");
  });

  it("returns a focused install manifest without adding offline behavior", () => {
    expect(manifest()).toMatchObject({
      name: "Rating App",
      short_name: "Rating App",
      start_url: "/",
      display: "standalone",
      background_color: "#101113",
      theme_color: "#101113",
      icons: [
        {
          src: "/icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
      ],
    });
  });

  it("declares deterministic public image responses at the intended dimensions", () => {
    expect(socialImageAlt).toContain("Herediano");
    expect(socialImageSize).toEqual({ width: 1200, height: 630 });
    expect(appleIconSize).toEqual({ width: 180, height: 180 });
    expect(getSocialCard().headers.get("content-type")).toBe("image/png");
    expect(AppleIcon().headers.get("content-type")).toBe("image/png");
  });
});
