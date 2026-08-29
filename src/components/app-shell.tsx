import Link from "next/link";
import type { ReactNode } from "react";

import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";

import { LanguageSwitcher } from "./language-switcher";

interface AppShellProps {
  children: ReactNode;
  locale: Locale;
  messages: Messages;
}

export function AppShell({ children, locale, messages }: AppShellProps) {
  const navigation = [
    { href: "/", label: messages.navigation.home, planned: false },
    { href: "/matches", label: messages.navigation.matches, planned: true },
    { href: "/players", label: messages.navigation.players, planned: true },
  ] as const;

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-3"
      >
        {messages.accessibility.skipToContent}
      </a>
      <header className="border-b border-border bg-white">
        <div className="page-shell">
          <div className="flex min-h-14 items-center justify-between gap-3">
            <Link
              href="/"
              aria-label={messages.accessibility.appHome}
              className="flex min-h-11 items-center gap-2 rounded-md"
            >
              <span
                aria-hidden="true"
                className="grid size-8 place-items-center rounded-lg bg-brand text-sm font-black text-white"
              >
                R
              </span>
              <span className="font-extrabold tracking-tight">Rating App</span>
            </Link>
            <LanguageSwitcher
              locale={locale}
              label={messages.common.language}
              languageNames={{
                es: messages.common.spanish,
                en: messages.common.english,
              }}
            />
          </div>
          <nav aria-label={messages.navigation.label}>
            <ul className="flex min-h-10 items-end gap-5">
              {navigation.map((item) => (
                <li key={item.href}>
                  {item.planned ? (
                    <span
                      aria-disabled="true"
                      className="flex min-h-10 items-center border-b-2 border-transparent text-sm font-semibold text-muted opacity-65"
                    >
                      {item.label}
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      aria-current="page"
                      className="flex min-h-10 items-center border-b-2 border-brand text-sm font-bold text-brand"
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      {children}
      <footer className="page-shell border-t border-border py-6 text-sm text-muted">
        {messages.footer.supporting}
      </footer>
    </div>
  );
}
