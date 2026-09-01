import type { MetadataRoute } from "next";

import { siteIdentity } from "@/config/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteIdentity.name,
    short_name: siteIdentity.name,
    description: siteIdentity.description,
    start_url: "/",
    display: "standalone",
    background_color: siteIdentity.backgroundColor,
    theme_color: siteIdentity.themeColor,
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
