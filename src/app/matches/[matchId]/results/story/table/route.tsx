import { ImageResponse } from "next/og";

import {
  buildPublishedRatingStoryPages,
  publishedRatingStoryFilename,
} from "@/application/published-rating-story";
import { STORY_IMAGE_SIZE } from "@/components/published-podium-image";
import { PublishedRatingTableImage } from "@/components/published-rating-table-image";
import { siteUrl } from "@/config/site";
import { AdminResultService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params;
  try {
    const pageNumber = requestedPage(request);
    if (pageNumber === null) return unavailableImage();

    const published = await new AdminResultService().getPublishedPageState(
      matchId,
    );
    if (published.state !== "ready" || published.podium === null) {
      return unavailableImage();
    }
    const storyPages = buildPublishedRatingStoryPages(published.podium);
    const storyPage = storyPages[pageNumber - 1];
    if (storyPage === undefined) return unavailableImage();

    return new ImageResponse(
      <PublishedRatingTableImage
        podium={published.podium}
        storyPage={storyPage}
        siteHost={siteUrl.hostname}
      />,
      {
        ...STORY_IMAGE_SIZE,
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `${storyDisposition(request)}; filename="${publishedRatingStoryFilename(matchId, storyPage.page, storyPage.pageCount)}"`,
        },
      },
    );
  } catch {
    return unavailableImage();
  }
}

function requestedPage(request: Request): number | null {
  const value = new URL(request.url).searchParams.get("page") ?? "1";
  const page = Number(value);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(page) ? page : null;
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
