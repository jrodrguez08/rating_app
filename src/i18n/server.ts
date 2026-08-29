import { cookies } from "next/headers";

import { localeCookieName, resolveLocale } from "./config";

export async function getLocale() {
  const cookieStore = await cookies();
  return resolveLocale(cookieStore.get(localeCookieName)?.value);
}
