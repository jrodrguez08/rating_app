import type { Metadata } from "next";

const PRODUCTION_SITE_URL = "https://rating-app-amber.vercel.app";

export const siteIdentity = {
  name: "Rating App",
  description:
    "Calificaciones de la afición para los protagonistas de cada partido.",
  socialDescription:
    "La voz de la afición en cada partido. Piloto para seguidores del Herediano.",
  socialImageAlt:
    "Rating App, calificaciones de la afición en el contexto del Herediano",
  themeColor: "#101113",
  backgroundColor: "#101113",
  primaryColor: "#b20d24",
  accentColor: "#f5c518",
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
  const title = overrides.title ?? siteIdentity.name;
  const description = overrides.description ?? siteIdentity.socialDescription;

  return {
    ...overrides,
    alternates: { canonical: pathname },
    openGraph: {
      type: "website",
      locale: "es_CR",
      url: pathname,
      siteName: siteIdentity.name,
      title,
      description,
      images: [
        {
          url: "/social-card",
          width: 1200,
          height: 630,
          alt: siteIdentity.socialImageAlt,
        },
      ],
    },
  };
}
