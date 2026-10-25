import { ImageResponse } from "next/og";

import {
  OPEN_GRAPH_IMAGE_SIZE,
  PublishedPodiumImage,
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
        variant="open-graph"
        photoDataUrls={photos}
        siteHost={siteUrl.hostname}
      />,
      {
        ...OPEN_GRAPH_IMAGE_SIZE,
        headers: { "Cache-Control": "no-store" },
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
