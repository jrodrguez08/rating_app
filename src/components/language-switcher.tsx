"use client";

import { useRouter } from "next/navigation";

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

  function selectLocale(nextLocale: Locale) {
    if (nextLocale === locale) return;
    persistLocale(nextLocale);
    router.refresh();
  }

  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-lg border border-border bg-white p-1"
    >
      {locales.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === locale}
          onClick={() => selectLocale(option)}
          className={`min-h-11 rounded-md px-3 text-sm font-semibold ${
            option === locale ? "bg-stone-100 text-foreground" : "text-muted"
          }`}
        >
          {languageNames[option]}
        </button>
      ))}
    </div>
  );
}
