import type { Metadata } from "next";

import { clubPath, resolveClub } from "./club";

const PRODUCTION_SITE_URL = "https://rating-app-amber.vercel.app";

export const siteIdentity = {
  name: "Rating App",
  description:
    "Calificaciones de la afición para los protagonistas de cada partido.",
  socialDescription: "La voz de la afición en cada partido.",
  socialImageAlt: "Rating App, calificaciones de la afición",
  themeColor: "#101113",
  backgroundColor: "#101113",
  primaryColor: "#36475c",
  accentColor: "#d1e0f0",
} as const;

export function resolveSiteUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): URL {
  const configured = environment.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return new URL(PRODUCTION_SITE_URL);

  const url = new URL(configured);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  return url;
}

export const siteUrl = resolveSiteUrl();

export function buildPageMetadata(
  pathname: string,
  overrides: Pick<Metadata, "title" | "description"> = {},
): Metadata {
  const club = resolveClub(pathname.split("/")[1] ?? "");
  const suppliedTitle = overrides.title ?? siteIdentity.name;
  const title =
    club &&
    typeof suppliedTitle === "string" &&
    !suppliedTitle.includes(club.displayName)
      ? `${suppliedTitle} | ${club.displayName}`
      : suppliedTitle;
  const description = overrides.description ?? siteIdentity.socialDescription;
  const imagePath = club ? clubPath(club, "/social-card") : undefined;

  return {
    ...overrides,
    title,
    description,
    alternates: { canonical: pathname },
    openGraph: {
      type: "website",
      locale: "es_CR",
      url: pathname,
      siteName: siteIdentity.name,
      title,
      description,
      images: imagePath
        ? [
            {
              url: imagePath,
              width: 1200,
              height: 630,
              alt: siteIdentity.socialImageAlt,
            },
          ]
        : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: imagePath ? [imagePath] : [],
    },
  };
}
