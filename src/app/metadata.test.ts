import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { siteIdentity } from "@/config/site";

const resultServiceMock = vi.hoisted(() => ({
  getPublishedPageState: vi.fn(),
}));
const localeMock = vi.hoisted(() => ({ getLocale: vi.fn() }));

vi.mock("@/i18n/server", () => localeMock);

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
  AdminResultService: class {
    getPublishedPageState = resultServiceMock.getPublishedPageState;
  },
  AdminStandingsService: vi.fn(() => {
    throw new Error("metadata must not access Firebase");
  }),
}));

import AppleIcon, { size as appleIconSize } from "./apple-icon";
import { generateMetadata, viewport } from "./layout";
import manifest from "./manifest";
import { generateMetadata as matchesMetadata } from "./[clubSlug]/matches/page";
import { generateMetadata as generateMatchMetadata } from "./[clubSlug]/matches/[matchId]/page";
import { generateMetadata as generateResultMetadata } from "./[clubSlug]/matches/[matchId]/results/page";
import { generateMetadata as playersMetadata } from "./[clubSlug]/players/page";
import { generateMetadata as standingsMetadata } from "./[clubSlug]/standings/page";
import { generateMetadata as generatePlayerMetadata } from "./[clubSlug]/players/[playerId]/page";
import {
  GET as getSocialCard,
  socialImageSize,
} from "./[clubSlug]/social-card/route";

beforeEach(() => {
  localeMock.getLocale.mockResolvedValue("es");
  resultServiceMock.getPublishedPageState.mockReset();
  resultServiceMock.getPublishedPageState.mockResolvedValue({
    state: "unavailable",
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("public app identity metadata", () => {
  it("publishes canonical Spanish root, Open Graph, and Twitter metadata", () => {
    const metadata = generateMetadata();
    const metadataBase = metadata.metadataBase as URL;
    const openGraph = metadata.openGraph!;
    const twitter = metadata.twitter!;

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
    expect(openGraph.images).toEqual([]);
    expect(twitter).toMatchObject({
      card: "summary_large_image",
      title: "Rating App",
      description: siteIdentity.socialDescription,
      images: [],
    });
  });

  it.each([
    ["Partidos", "/herediano/matches", matchesMetadata],
    ["Jugadores", "/herediano/players", playersMetadata],
    ["Tabla de posiciones", "/herediano/standings", standingsMetadata],
  ])(
    "publishes the %s page with its own canonical and complete Open Graph identity",
    async (title, pathname, generate) => {
      const pageMetadata = await generate({
        params: Promise.resolve({ clubSlug: "herediano" }),
      } as never);
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
        title: `${title} | Club Sport Herediano`,
        siteName: "Rating App",
        type: "website",
        locale: "es_CR",
        images: [
          {
            url: "/herediano/social-card",
            width: 1200,
            height: 630,
            alt: siteIdentity.socialImageAlt,
          },
        ],
      });
      expect(resolvedMetadata.twitter).toMatchObject({
        card: "summary_large_image",
        images: ["/herediano/social-card"],
      });
    },
  );

  it("builds safe dynamic route identity from params", async () => {
    const cases = [
      [generateMatchMetadata, "fixture/id", "/herediano/matches/fixture%2Fid"],
      [
        generateResultMetadata,
        "fixture/id",
        "/herediano/matches/fixture%2Fid/results",
      ],
      [generatePlayerMetadata, "player/id", "/herediano/players/player%2Fid"],
    ] as const;

    for (const [generate, id, pathname] of cases) {
      const pageMetadata = await generate({
        params: Promise.resolve(
          pathname.includes("/players")
            ? { clubSlug: "herediano", playerId: id }
            : { clubSlug: "herediano", matchId: id },
        ),
      } as never);

      expect(pageMetadata.alternates!.canonical).toBe(pathname);
      expect(pageMetadata.openGraph).toMatchObject({
        url: pathname,
        siteName: "Rating App",
        images: [{ url: "/herediano/social-card" }],
      });
    }
  });

  it("publishes match-specific canonical, Open Graph, and Twitter metadata only for a current published podium", async () => {
    resultServiceMock.getPublishedPageState.mockResolvedValueOnce({
      state: "ready",
      match: {
        trackedTeamId: "club-sport-herediano",
        homeTeam: { name: "Herediano" },
        awayTeam: { name: "Pérez Zeledón" },
      },
      podium: {
        score: { home: 2, away: 1 },
        generatedAt: "2026-10-20T05:00:00.000Z",
      },
    });

    const metadata = await generateResultMetadata({
      params: Promise.resolve({
        clubSlug: "herediano",
        matchId: "published-match",
      }),
    } as never);
    const image = Array.isArray(metadata.openGraph!.images)
      ? metadata.openGraph!.images[0]
      : metadata.openGraph!.images;

    expect(metadata.title).toContain("Herediano 2 - 1 Pérez Zeledón");
    expect(metadata.alternates!.canonical).toBe(
      "https://rating-app-amber.vercel.app/herediano/matches/published-match/results",
    );
    expect(image).toMatchObject({
      width: 1200,
      height: 630,
      url: expect.stringContaining(
        "/herediano/matches/published-match/results/opengraph-image?lang=es&v=",
      ),
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [expect.stringContaining("/opengraph-image?lang=es&v=")],
    });
  });

  it("uses English result metadata and an explicitly English image URL", async () => {
    localeMock.getLocale.mockResolvedValue("en");
    resultServiceMock.getPublishedPageState.mockResolvedValueOnce({
      state: "ready",
      match: {
        trackedTeamId: "deportivo-saprissa",
        homeTeam: { name: "Herediano" },
        awayTeam: { name: "Saprissa" },
      },
      podium: {
        score: { home: 2, away: 1 },
        generatedAt: "2026-10-20T05:00:00.000Z",
      },
    });
    vi.stubEnv("SAPRISSA_PUBLIC_ENABLED", "true");
    const metadata = await generateResultMetadata({
      params: Promise.resolve({
        clubSlug: "saprissa",
        matchId: "published-match",
      }),
    } as never);
    expect(metadata.title).toContain("Fans' top players");
    expect(metadata.description).toContain(
      "Published Deportivo Saprissa results",
    );
    expect(metadata.openGraph).toMatchObject({
      locale: "en_US",
      images: [
        {
          url: expect.stringContaining("?lang=en&v="),
          alt: expect.stringContaining("Deportivo Saprissa podium"),
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      title: expect.stringContaining("Fans' top players"),
      images: [expect.stringContaining("?lang=en&v=")],
    });
  });

  it("wires the browser icon, Apple touch icon, manifest, and dark browser theme", () => {
    const metadata = generateMetadata();
    expect(metadata.icons).toMatchObject({
      icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
      apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }],
    });
    expect(metadata.manifest).toBe("/manifest.webmanifest");
    expect(viewport).toEqual({ themeColor: "#101113", colorScheme: "dark" });
    expect(readFileSync("src/app/icon.svg", "utf8")).toContain("#36475c");
    expect(readFileSync("src/app/icon.svg", "utf8")).not.toContain("#b20d24");
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

  it("declares deterministic club image responses at the intended dimensions", async () => {
    expect(socialImageSize).toEqual({ width: 1200, height: 630 });
    expect(appleIconSize).toEqual({ width: 180, height: 180 });
    expect(
      (
        await getSocialCard(
          new Request("https://rating.test/herediano/social-card"),
          { params: Promise.resolve({ clubSlug: "herediano" }) },
        )
      ).headers.get("content-type"),
    ).toBe("image/png");
    expect(AppleIcon().headers.get("content-type")).toBe("image/png");
  });
});
