export const locales = ["es", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "es";
export const localeCookieName = "rating-app-locale";
export const openGraphLocales: Record<Locale, string> = {
  es: "es_CR",
  en: "en_US",
};

export function resolveLocale(value: string | null | undefined): Locale {
  return locales.find((locale) => locale === value) ?? defaultLocale;
}

export function imageLocaleFromRequest(request: Request): Locale {
  const values = new URL(request.url).searchParams.getAll("lang");
  return values.length === 1 ? resolveLocale(values[0]) : defaultLocale;
}
