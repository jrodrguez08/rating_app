import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { MatchDetail } from "@/components/match-detail";
import { initialClub } from "@/config/club";
import { buildPageMetadata } from "@/config/site";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminMatchArchiveService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: PageProps<"/matches/[matchId]">): Promise<Metadata> {
  const { matchId } = await params;
  return buildPageMetadata(`/matches/${encodeURIComponent(matchId)}`);
}

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const locale = await getLocale();
  const messages = getMessages(locale);
  const { matchId } = await params;
  let unavailable = false;
  let item;
  try {
    item = await new AdminMatchArchiveService().get(
      matchId,
      initialClub.teamId,
    );
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
      theme={initialClub.theme}
      currentHref="/matches"
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {item ? (
          <MatchDetail
            item={item}
            locale={locale}
            messages={messages.matches}
            ballotMessages={messages.home.matchLifecycle.ready}
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
