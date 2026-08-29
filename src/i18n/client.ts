import { localeCookieName, type Locale } from "./config";

export function persistLocale(locale: Locale): void {
  document.cookie = `${localeCookieName}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
