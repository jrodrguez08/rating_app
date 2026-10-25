import { ImageResponse } from "next/og";

import {
  PublishedPodiumImage,
  STORY_IMAGE_SIZE,
} from "@/components/published-podium-image";
import { siteUrl } from "@/config/site";
import { AdminResultService } from "@/lib/firebase/server";
import { loadSocialPlayerPhotos } from "@/lib/server/social-player-photo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params;
  try {
    const page = await new AdminResultService().getPublishedPageState(matchId);
    if (page.state !== "ready" || page.podium === null) {
      return unavailableImage();
    }
    const photos = await loadSocialPlayerPhotos(page.podium.topThree);
    return new ImageResponse(
      <PublishedPodiumImage
        podium={page.podium}
        variant="story"
        photoDataUrls={photos}
        siteHost={siteUrl.hostname}
      />,
      {
        ...STORY_IMAGE_SIZE,
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${storyFilename(matchId)}"`,
        },
      },
    );
  } catch {
    return unavailableImage();
  }
}

function unavailableImage() {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function storyFilename(matchId: string): string {
  const safeMatchId = matchId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `rating-app-${safeMatchId}-historia.png`;
}
