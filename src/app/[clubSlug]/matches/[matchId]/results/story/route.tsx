import { ImageResponse } from "next/og";

import {
  PublishedPodiumImage,
  STORY_IMAGE_SIZE,
} from "@/components/published-podium-image";
import { requireActiveClub } from "@/config/club-server";
import { siteUrl } from "@/config/site";
import { AdminResultService } from "@/lib/firebase/server";
import { loadSocialPlayerPhotos } from "@/lib/server/social-player-photo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clubSlug: string; matchId: string }> },
) {
  const { clubSlug, matchId } = await params;
  const club = requireActiveClub(clubSlug);
  try {
    const page = await new AdminResultService().getPublishedPageState(
      matchId,
      club.teamId,
    );
    if (
      page.state !== "ready" ||
      page.podium === null ||
      page.match.trackedTeamId !== club.teamId
    ) {
      return unavailableImage();
    }
    const photos = await loadSocialPlayerPhotos(page.podium.topThree);
    return new ImageResponse(
      <PublishedPodiumImage
        club={club}
        podium={page.podium}
        variant="story"
        photoDataUrls={photos}
        siteHost={siteUrl.hostname}
      />,
      {
        ...STORY_IMAGE_SIZE,
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `${storyDisposition(request)}; filename="${storyFilename(club.slug, matchId)}"`,
        },
      },
    );
  } catch {
    return unavailableImage();
  }
}

function storyDisposition(request: Request): "attachment" | "inline" {
  return new URL(request.url).searchParams.get("view") === "1"
    ? "inline"
    : "attachment";
}

function unavailableImage() {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function storyFilename(clubSlug: string, matchId: string): string {
  const safeClubSlug = clubSlug.replace(/[^a-zA-Z0-9_-]/g, "-");
  const safeMatchId = matchId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `rating-app-${safeClubSlug}-${safeMatchId}-historia.png`;
}
