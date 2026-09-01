import { ImageResponse } from "next/og";

import { siteIdentity } from "@/config/site";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: siteIdentity.backgroundColor,
      }}
    >
      <div
        style={{
          width: 132,
          height: 132,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `10px solid ${siteIdentity.primaryColor}`,
          background: siteIdentity.accentColor,
          color: siteIdentity.backgroundColor,
          fontSize: 76,
          fontWeight: 900,
          lineHeight: 1,
        }}
      >
        R
      </div>
    </div>,
    size,
  );
}
