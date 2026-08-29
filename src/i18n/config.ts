export const locales = ["es", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "es";
export const localeCookieName = "rating-app-locale";

export function resolveLocale(value: string | null | undefined): Locale {
  return locales.find((locale) => locale === value) ?? defaultLocale;
}
