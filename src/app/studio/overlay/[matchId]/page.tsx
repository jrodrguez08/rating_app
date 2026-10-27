import type { Metadata } from "next";

import {
  buildStudioMatchPresentation,
  type StudioMatchPresentation,
} from "@/application/studio";
import { StudioBoard } from "@/components/studio-board";
import { initialClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminResultService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Rating App Studio",
  robots: { index: false, follow: false },
};

export default async function StudioOverlayPage({
  params,
}: PageProps<"/studio/overlay/[matchId]">) {
  const locale = await getLocale();
  const messages = getMessages(locale);
  const { matchId } = await params;
  let presentation: StudioMatchPresentation | null = null;
  try {
    const page = await new AdminResultService().getPublishedPageState(matchId);
    if (
      page.state === "ready" &&
      page.match.trackedTeamId === initialClub.teamId
    ) {
      presentation = buildStudioMatchPresentation(
        page.match,
        page.result,
        page.podium,
      );
    }
  } catch {
    console.error("Studio overlay is temporarily unavailable.", { matchId });
  }
  if (presentation !== null) {
    return (
      <main
        id="main-content"
        className="h-screen w-screen overflow-hidden bg-background"
      >
        <StudioBoard
          presentation={presentation}
          locale={locale}
          messages={messages.studio}
          view="podium"
          overlay
        />
      </main>
    );
  }
  return (
    <main
      id="main-content"
      className="grid h-screen w-screen place-items-center overflow-hidden bg-background p-6 text-foreground"
    >
      <p className="score-font text-center text-xl text-muted">
        {messages.studio.overlayUnavailable}
      </p>
    </main>
  );
}
