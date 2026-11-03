import { ImageResponse } from "next/og";

import {
  OPEN_GRAPH_IMAGE_SIZE,
  PublishedPodiumImage,
} from "@/components/published-podium-image";
import { requireActiveClub } from "@/config/club-server";
import { siteUrl } from "@/config/site";
import { imageLocaleFromRequest } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
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
  const locale = imageLocaleFromRequest(request);
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
        locale={locale}
        messages={getMessages(locale).results.image}
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
