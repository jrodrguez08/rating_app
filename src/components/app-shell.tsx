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
        <div className="page-shell flex min-h-18 flex-wrap items-center justify-between gap-2 py-2 sm:gap-4">
          <Link
            href="/"
            aria-label={messages.accessibility.appHome}
            className="flex min-h-11 items-center gap-3 rounded-md"
          >
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-xl bg-brand font-black text-white"
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
          <nav
            aria-label={messages.navigation.label}
            className="order-last w-full sm:order-none sm:w-auto"
          >
            <ul className="flex items-center gap-1">
              {navigation.map((item) => (
                <li key={item.href}>
                  {item.planned ? (
                    <span
                      aria-disabled="true"
                      className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-muted opacity-65"
                    >
                      {item.label}
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      aria-current="page"
                      className="flex min-h-11 items-center rounded-lg bg-red-50 px-3 text-sm font-bold text-brand"
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
