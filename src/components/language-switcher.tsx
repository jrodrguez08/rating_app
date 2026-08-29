"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { persistLocale } from "@/i18n/client";
import { locales, type Locale } from "@/i18n/config";

import { ChevronDownIcon } from "./game-icons";

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
        className="button-utility score-font flex min-w-11 items-center justify-center gap-1 px-2 text-xs"
      >
        {locale.toUpperCase()}
        <ChevronDownIcon aria-hidden="true" className="size-3" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-40 mt-2 min-w-36 border-2 border-border bg-surface-raised p-1 shadow-[var(--shadow-panel)]"
        >
          {locales.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === locale}
              onClick={() => selectLocale(option)}
              className="flex min-h-11 w-full items-center justify-between gap-4 border border-transparent px-3 text-left text-sm font-semibold text-foreground hover:border-border hover:bg-surface"
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
