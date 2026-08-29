import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Home", planned: false },
  { href: "/matches", label: "Matches", planned: true },
  { href: "/players", label: "Players", planned: true },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-white">
        <div className="page-shell flex min-h-18 items-center justify-between gap-4">
          <Link
            href="/"
            aria-label="Rating App home"
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
          <nav aria-label="Primary navigation">
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
        Built for supporters. Ready to grow club by club.
      </footer>
    </div>
  );
}
