import { ImageResponse } from "next/og";

import { requireClub } from "@/config/club-server";
import { siteIdentity } from "@/config/site";

export const socialImageSize = { width: 1200, height: 630 };
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clubSlug: string }> },
) {
  const { clubSlug } = await params;
  const club = requireClub(clubSlug);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        alignItems: "center",
        padding: "72px 88px",
        background: siteIdentity.backgroundColor,
        color: "#f7f2e8",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "74%",
          height: 18,
          background: club.theme.primary,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: "26%",
          height: 18,
          background: club.theme.accent,
        }}
      />
      <div
        style={{
          width: 210,
          height: 210,
          display: "flex",
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          border: `14px solid ${club.theme.primary}`,
          boxShadow: "16px 16px 0 #050506",
          background: club.theme.accent,
          color: siteIdentity.backgroundColor,
          fontSize: 128,
          fontWeight: 900,
        }}
      >
        R
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginLeft: 72,
          maxWidth: 700,
        }}
      >
        <div
          style={{
            color: club.theme.accent,
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          La voz de la afición
        </div>
        <div style={{ fontSize: 92, fontWeight: 900, lineHeight: 1.05 }}>
          Rating App
        </div>
        <div
          style={{
            marginTop: 24,
            color: "#d3cec5",
            fontSize: 32,
            lineHeight: 1.3,
          }}
        >
          Califica a los protagonistas de cada partido.
        </div>
        <div
          style={{
            alignSelf: "flex-start",
            marginTop: 28,
            border: `3px solid ${club.theme.primary}`,
            padding: "10px 16px",
            color: "#f7f2e8",
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          {club.publicAvailability === "active"
            ? club.displayName
            : `${club.displayName} · próximamente`}
        </div>
      </div>
    </div>,
    socialImageSize,
  );
}
