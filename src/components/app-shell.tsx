import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import type { TeamPresentation } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";

import { LanguageSwitcher } from "./language-switcher";

interface AppShellProps {
  children: ReactNode;
  locale: Locale;
  messages: Messages;
  theme: TeamPresentation["theme"];
  currentHref?: "/" | "/matches" | null;
}

export function AppShell({
  children,
  locale,
  messages,
  theme,
  currentHref = "/",
}: AppShellProps) {
  const navigation = [
    { href: "/", label: messages.navigation.home, planned: false },
    { href: "/matches", label: messages.navigation.matches, planned: false },
    { href: "/players", label: messages.navigation.players, planned: true },
  ] as const;
  const clubTheme = {
    "--club-primary": theme.primary,
    "--club-secondary": theme.accent,
  } as CSSProperties;

  return (
    <div
      style={clubTheme}
      className="min-h-screen bg-background text-foreground"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border-2 focus:border-accent focus:bg-surface focus:px-4 focus:py-3"
      >
        {messages.accessibility.skipToContent}
      </a>
      <header className="border-b-2 border-border bg-surface">
        <div className="page-shell">
          <div className="flex min-h-14 items-center justify-between gap-3">
            <Link
              href="/"
              aria-label={messages.accessibility.appHome}
              className="flex min-h-11 items-center gap-2"
            >
              <span
                aria-hidden="true"
                className="score-font grid size-8 place-items-center border-2 border-accent bg-brand text-sm text-white shadow-[2px_2px_0_var(--game-shadow)]"
              >
                R
              </span>
              <span className="score-font text-sm uppercase text-foreground sm:text-base">
                Rating App
              </span>
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
                      aria-current={
                        item.href === currentHref ? "page" : undefined
                      }
                      className={`flex min-h-10 items-center border-b-2 text-sm font-extrabold text-foreground ${
                        item.href === currentHref
                          ? "border-accent"
                          : "border-transparent"
                      }`}
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
      <footer className="page-shell border-t-2 border-border py-5 text-sm text-muted">
        {messages.footer.supporting}
      </footer>
    </div>
  );
}
