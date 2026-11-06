"use client";

import { Analytics, type BeforeSend } from "@vercel/analytics/next";
import { usePathname } from "next/navigation";

import { resolveClub } from "@/config/club";

// Public HTML pages only. Asset endpoints under a match are excluded too.
const publicClubPage =
  /^(?:(?:standings|players(?:\/[^/]+)?|matches(?:\/[^/]+(?:\/(?:rate|results))?)?|studio(?:\/overlay\/[^/]+)?)\/?)?$/;

function isPublicPage(pathname: string): boolean {
  if (pathname === "/") return true;
  const [, slug = "", ...segments] = pathname.split("/");
  return resolveClub(slug) !== null && publicClubPage.test(segments.join("/"));
}

const beforeSend: BeforeSend = (event) => {
  // The tracker can also include the incoming referrer, outside event.url.
  if (event.type !== "pageview" || /[?#]/.test(document.referrer)) return null;

  try {
    const url = new URL(event.url);
    if (!isPublicPage(url.pathname)) return null;
    return { type: "pageview", url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
};

export function PublicWebAnalytics() {
  const pathname = usePathname();
  return isPublicPage(pathname) ? <Analytics beforeSend={beforeSend} /> : null;
}
