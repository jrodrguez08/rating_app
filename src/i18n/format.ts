import type { Locale } from "./config";

const localeTags: Record<Locale, string> = {
  es: "es-CR",
  en: "en-US",
};

export function formatDate(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(localeTags[locale], {
    timeZone: "America/Costa_Rica",
    ...options,
  }).format(new Date(value));
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(localeTags[locale], options).format(value);
}

export function formatRating(value: number, locale: Locale): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
