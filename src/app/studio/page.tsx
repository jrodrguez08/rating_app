import type { Metadata } from "next";

import {
  buildStudioMatchPresentation,
  type StudioMatchOption,
  type StudioMatchPresentation,
} from "@/application/studio";
import { AppShell } from "@/components/app-shell";
import { StudioExperience } from "@/components/studio-experience";
import { initialClub } from "@/config/club";
import { buildPageMetadata, siteUrl } from "@/config/site";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminResultService, AdminStudioService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const messages = getMessages(await getLocale());
  return buildPageMetadata("/studio", {
    title: messages.studio.metadataTitle,
    description: messages.studio.metadataDescription,
  });
}

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ match?: string | string[] }>;
}) {
  const locale = await getLocale();
  const messages = getMessages(locale);
  const requestedValue = (await searchParams).match;
  const requestedMatchId =
    typeof requestedValue === "string" && requestedValue.trim() !== ""
      ? requestedValue
      : undefined;
  const studioService = new AdminStudioService();
  const resultService = new AdminResultService();
  let matches: StudioMatchOption[] = [];
  let unavailable = false;
  try {
    matches = await studioService.listPublishedMatches(initialClub.teamId);
  } catch {
    unavailable = true;
    console.error("Studio match catalog is temporarily unavailable.");
  }

  let presentation: StudioMatchPresentation | null = null;
  const candidates = [requestedMatchId, matches[0]?.matchId].filter(
    (value, index, values): value is string =>
      value !== undefined && values.indexOf(value) === index,
  );
  for (const matchId of candidates) {
    try {
      const page = await resultService.getPublishedPageState(matchId);
      if (
        page.state !== "ready" ||
        page.match.trackedTeamId !== initialClub.teamId
      ) {
        continue;
      }
      presentation = buildStudioMatchPresentation(
        page.match,
        page.result,
        page.podium,
      );
      if (presentation !== null) break;
    } catch {
      console.error("Studio result is temporarily unavailable.", { matchId });
    }
  }

  if (
    presentation !== null &&
    !matches.some(({ matchId }) => matchId === presentation?.match.id)
  ) {
    matches = [optionFromPresentation(presentation), ...matches];
  }

  return (
    <AppShell
      locale={locale}
      messages={messages}
      theme={initialClub.theme}
      currentHref="/studio"
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {presentation ? (
          <StudioExperience
            presentation={presentation}
            matches={matches}
            overlayUrl={
              new URL(
                `/studio/overlay/${encodeURIComponent(presentation.match.id)}`,
                siteUrl,
              ).href
            }
            locale={locale}
            messages={messages.studio}
          />
        ) : (
          <section
            className="card p-6 text-center"
            aria-labelledby="studio-state-heading"
          >
            <h1 id="studio-state-heading" className="score-font text-2xl">
              {unavailable
                ? messages.studio.unavailableTitle
                : messages.studio.emptyTitle}
            </h1>
            <p className="mt-3 leading-6 text-muted">
              {unavailable
                ? messages.studio.unavailableDescription
                : messages.studio.emptyDescription}
            </p>
          </section>
        )}
      </main>
    </AppShell>
  );
}

function optionFromPresentation(
  presentation: StudioMatchPresentation,
): StudioMatchOption {
  return {
    matchId: presentation.match.id,
    kickoffAt: presentation.match.kickoffAt,
    homeTeamName: presentation.match.homeTeam.name,
    awayTeamName: presentation.match.awayTeam.name,
    score: presentation.podium.score,
  };
}
