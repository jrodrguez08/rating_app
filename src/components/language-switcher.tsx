"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { persistLocale } from "@/i18n/client";
import { locales, type Locale } from "@/i18n/config";

interface LanguageSwitcherProps {
  locale: Locale;
  label: string;
  languageNames: Record<Locale, string>;
}

export function LanguageSwitcher({
  locale,
  label,
  languageNames,
}: LanguageSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectLocale(nextLocale: Locale) {
    setOpen(false);
    if (nextLocale === locale) {
      triggerRef.current?.focus();
      return;
    }
    persistLocale(nextLocale);
    router.refresh();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${languageNames[locale]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-sm font-bold text-muted"
      >
        {locale.toUpperCase()}
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-40 mt-1 min-w-36 rounded-lg border border-border bg-white p-1 shadow-[var(--shadow-card)]"
        >
          {locales.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === locale}
              onClick={() => selectLocale(option)}
              className="flex min-h-11 w-full items-center justify-between gap-4 rounded-md px-3 text-left text-sm font-semibold text-foreground hover:bg-stone-100"
            >
              {languageNames[option]}
              {option === locale ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
