import type { Metadata } from "next";
import { DotGothic16 } from "next/font/google";

import { VoterIdentityInitializer } from "@/components/voter-identity-initializer";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";

import "./globals.css";

const gameFont = DotGothic16({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-dot-gothic",
  fallback: ["Arial", "sans-serif"],
});

export async function generateMetadata(): Promise<Metadata> {
  const messages = getMessages(await getLocale());
  return messages.metadata;
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
