import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { MatchDetail } from "@/components/match-detail";
import { clubPath } from "@/config/club";
import { requireActiveClub } from "@/config/club-server";
import { buildPageMetadata } from "@/config/site";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminMatchArchiveService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: PageProps<"/[clubSlug]/matches/[matchId]">): Promise<Metadata> {
  const { clubSlug, matchId } = await params;
  const club = requireActiveClub(clubSlug);
  return buildPageMetadata(
    clubPath(club, `/matches/${encodeURIComponent(matchId)}`),
  );
}

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ clubSlug: string; matchId: string }>;
}) {
  const { clubSlug, matchId } = await params;
  const club = requireActiveClub(clubSlug);
  const locale = await getLocale();
  const messages = getMessages(locale);
  let unavailable = false;
  let item;
  try {
    item = await new AdminMatchArchiveService().get(matchId, club.teamId);
  } catch {
    console.error("Match detail is temporarily unavailable.", { matchId });
    unavailable = true;
    item = null;
  }
  if (item === null && !unavailable) notFound();
  return (
    <AppShell
      locale={locale}
      messages={messages}
      club={club}
      currentHref={clubPath(club, "/matches")}
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {item ? (
          <MatchDetail
            item={item}
            club={club}
            locale={locale}
            messages={messages.matches}
            ballotMessages={messages.home.matchLifecycle.ready}
            now={new Date()}
          />
        ) : (
          <section className="card p-6 text-center">
            <h1 className="score-font text-2xl">
              {messages.matches.detailUnavailable}
            </h1>
          </section>
        )}
      </main>
    </AppShell>
  );
}
