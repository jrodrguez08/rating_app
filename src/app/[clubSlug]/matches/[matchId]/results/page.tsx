import type { Metadata } from "next";
import { cache } from "react";

import { AppShell } from "@/components/app-shell";
import { MatchResults, ResultRouteState } from "@/components/match-results";
import { matchPath } from "@/config/club";
import { requireActiveClub } from "@/config/club-server";
import { buildPageMetadata, siteIdentity, siteUrl } from "@/config/site";
import { openGraphLocales } from "@/i18n/config";
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
  const locale = await getLocale();
  const messages = getMessages(locale).results;
  const pathname = matchPath(club, matchId, "/results");
  const fallback = buildPageMetadata(
    pathname,
    { title: messages.title, description: messages.unavailableDescription },
    locale,
  );
  try {
    const pageState = await readPublishedResult(matchId, club.teamId);
    if (pageState.state !== "ready" || pageState.podium === null) {
      return { ...fallback, robots: { index: false, follow: false } };
    }
    const { match, podium } = pageState;
    const score = `${podium.score.home} - ${podium.score.away}`;
    const fields = {
      club: club.displayName,
      home: match.homeTeam.name,
      away: match.awayTeam.name,
      score,
    };
    const fill = (template: string) =>
      template.replace(
        /\{(club|home|away|score)\}/g,
        (_, field: keyof typeof fields) => fields[field],
      );
    const title = fill(messages.metadata.title);
    const description = fill(messages.metadata.description);
    const canonicalUrl = new URL(pathname, siteUrl).href;
    const imageUrl = new URL(
      `${pathname}/opengraph-image?lang=${locale}&v=${encodeURIComponent(podium.generatedAt)}`,
      siteUrl,
    ).href;
    return {
      title,
      description,
      alternates: { canonical: canonicalUrl },
      openGraph: {
        type: "website",
        locale: openGraphLocales[locale],
        url: canonicalUrl,
        siteName: siteIdentity.name,
        title,
        description,
        images: [
          {
            url: imageUrl,
            width: 1200,
            height: 630,
            alt: fill(messages.metadata.imageAlt),
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
