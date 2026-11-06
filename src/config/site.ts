import type { Metadata } from "next";

import { defaultLocale, openGraphLocales, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

import { clubPath, resolveClub } from "./club";

const PRODUCTION_SITE_URL = "https://www.futratecr.com";

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
  environment: Readonly<Record<string, string | undefined>> = {
    // Next.js only inlines direct NEXT_PUBLIC references in browser bundles.
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
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
  locale: Locale = defaultLocale,
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
      locale: openGraphLocales[locale],
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
              alt: getMessages(locale).metadata.socialImageAlt,
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
