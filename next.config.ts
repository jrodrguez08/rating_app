import type { NextConfig } from "next";

import {
  PLAYER_PHOTO_HOST,
  PLAYER_PHOTO_PATHNAME,
} from "./src/config/player-photos";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: PLAYER_PHOTO_HOST,
        pathname: PLAYER_PHOTO_PATHNAME,
      },
    ],
  },
};

export default nextConfig;
