import type { Metadata } from "next";
import { cache } from "react";

import { AppShell } from "@/components/app-shell";
import { MatchResults, ResultRouteState } from "@/components/match-results";
import { matchPath } from "@/config/club";
import { requireActiveClub } from "@/config/club-server";
import { buildPageMetadata, siteIdentity, siteUrl } from "@/config/site";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminResultService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const readPublishedResult = cache(async (matchId: string, teamId: string) => {
  const page = await new AdminResultService().getPublishedPageState(
    matchId,
    teamId,
  );
  return page.match && page.match.trackedTeamId !== teamId
    ? { state: "unavailable" as const }
    : page;
});

export async function generateMetadata({
  params,
}: PageProps<"/[clubSlug]/matches/[matchId]/results">): Promise<Metadata> {
  const { clubSlug, matchId } = await params;
  const club = requireActiveClub(clubSlug);
  const pathname = matchPath(club, matchId, "/results");
  const fallback = buildPageMetadata(pathname);
  try {
    const pageState = await readPublishedResult(matchId, club.teamId);
    if (pageState.state !== "ready" || pageState.podium === null) {
      return { ...fallback, robots: { index: false, follow: false } };
    }
    const { match, podium } = pageState;
    const score = `${podium.score.home} - ${podium.score.away}`;
    const title = `${match.homeTeam.name} ${score} ${match.awayTeam.name} | La afición eligió sus mejores jugadores`;
    const description = `Resultados publicados de ${match.homeTeam.name} vs ${match.awayTeam.name}: marcador ${score} y los jugadores mejor calificados por la afición.`;
    const canonicalUrl = new URL(pathname, siteUrl).href;
    const imageUrl = new URL(
      `${pathname}/opengraph-image?v=${encodeURIComponent(podium.generatedAt)}`,
      siteUrl,
    ).href;
    return {
      title,
      description,
      alternates: { canonical: canonicalUrl },
      openGraph: {
        type: "website",
        locale: "es_CR",
        url: canonicalUrl,
        siteName: siteIdentity.name,
        title,
        description,
        images: [
          {
            url: imageUrl,
            width: 1200,
            height: 630,
            alt: `Podio de ${match.homeTeam.name} vs ${match.awayTeam.name}, ${score}`,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [imageUrl],
      },
    };
  } catch {
    return { ...fallback, robots: { index: false, follow: false } };
  }
}

export default async function MatchResultsPage({
  params,
}: {
  params: Promise<{ clubSlug: string; matchId: string }>;
}) {
  const { clubSlug, matchId } = await params;
  const club = requireActiveClub(clubSlug);
  const locale = await getLocale();
  const messages = getMessages(locale);
  let pageState: Awaited<
    ReturnType<AdminResultService["getPublishedPageState"]>
  > = {
    state: "unavailable",
  };
  try {
    pageState = await readPublishedResult(matchId, club.teamId);
  } catch {
    console.error("Result page data is temporarily unavailable.", { matchId });
  }
  return (
    <AppShell
      locale={locale}
      messages={messages}
      club={club}
      currentHref={null}
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {pageState.state === "ready" ? (
          <MatchResults
            club={club}
            match={pageState.match}
            result={pageState.result}
            podium={pageState.podium}
            locale={locale}
            messages={messages.results}
          />
        ) : (
          <ResultRouteState
            club={club}
            state={pageState.state}
            messages={messages.results}
          />
        )}
      </main>
    </AppShell>
  );
}
