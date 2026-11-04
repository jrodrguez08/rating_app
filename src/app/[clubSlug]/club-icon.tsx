import { ImageResponse } from "next/og";

import type { Club } from "@/config/club";

export function clubIcon(club: Club, size: number): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#101113",
      }}
    >
      <div
        style={{
          width: "75%",
          height: "75%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `${Math.max(3, Math.round(size / 18))}px solid ${club.theme.accent}`,
          background: club.theme.primary,
          color: "#ffffff",
          fontSize: Math.round(size * 0.48),
          fontWeight: 900,
        }}
      >
        R
      </div>
    </div>,
    { width: size, height: size },
  );
}
