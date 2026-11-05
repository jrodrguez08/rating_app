import Link from "next/link";
import type { CSSProperties } from "react";

import { BrandIdentity } from "@/components/brand-identity";
import { LanguageSwitcher } from "@/components/language-switcher";
import { clubs, clubPath } from "@/config/club";
import { publicClub } from "@/config/club-operations";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";

export default async function ClubSelectionPage() {
  const locale = await getLocale();
  const messages = getMessages(locale);
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border-2 focus:border-accent focus:bg-surface focus:px-4 focus:py-3"
      >
        {messages.accessibility.skipToContent}
      </a>
      <main id="main-content" className="page-shell py-10">
        <header className="flex items-start justify-between gap-4">
          <h1>
            <Link href="/" className="flex min-h-12 items-center gap-3">
              <BrandIdentity prominent />
            </Link>
          </h1>
          <LanguageSwitcher
            locale={locale}
            label={messages.common.language}
            languageNames={{
              es: messages.common.spanish,
              en: messages.common.english,
            }}
          />
        </header>
        <p className="mt-4 text-muted">{messages.clubs.choose}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {Object.values(clubs).map(({ slug }) => {
            const club = publicClub(slug);
            return (
              <Link
                key={club.slug}
                href={clubPath(club)}
                className="card flex min-h-24 items-center border-l-4 p-5 text-lg font-bold hover:text-accent"
                style={
                  {
                    borderLeftColor: club.theme.primary,
                    "--club-secondary": club.theme.accent,
                  } as CSSProperties
                }
              >
                {club.displayName}
              </Link>
            );
          })}
        </div>
      </main>
    </>
  );
}
