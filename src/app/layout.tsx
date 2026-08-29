import type { Metadata } from "next";

import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const messages = getMessages(await getLocale());
  return messages.metadata;
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
