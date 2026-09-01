import type { Metadata, Viewport } from "next";
import { DotGothic16 } from "next/font/google";

import { VoterIdentityInitializer } from "@/components/voter-identity-initializer";
import { buildPageMetadata, siteIdentity, siteUrl } from "@/config/site";
import { getLocale } from "@/i18n/server";

import "./globals.css";

const gameFont = DotGothic16({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-dot-gothic",
  fallback: ["Arial", "sans-serif"],
});

export const viewport: Viewport = {
  themeColor: siteIdentity.themeColor,
  colorScheme: "dark",
};

export function generateMetadata(): Metadata {
  return {
    ...buildPageMetadata("/"),
    metadataBase: siteUrl,
    title: {
      default: siteIdentity.name,
      template: `%s | ${siteIdentity.name}`,
    },
    description: siteIdentity.description,
    applicationName: siteIdentity.name,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
      shortcut: ["/icon.svg"],
      apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }],
    },
    twitter: {
      card: "summary_large_image",
      title: siteIdentity.name,
      description: siteIdentity.socialDescription,
      images: ["/social-card"],
    },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`h-full ${gameFont.variable}`}>
      <body className="min-h-full">
        <VoterIdentityInitializer />
        {children}
      </body>
    </html>
  );
}
