import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PlayerProfile } from "@/components/player-history";
import { clubPath } from "@/config/club";
import { requireActiveClub } from "@/config/club-server";
import { buildPageMetadata } from "@/config/site";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminPlayerHistoryService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: PageProps<"/[clubSlug]/players/[playerId]">): Promise<Metadata> {
  const { clubSlug, playerId } = await params;
  const club = requireActiveClub(clubSlug);
  return buildPageMetadata(
    clubPath(club, `/players/${encodeURIComponent(playerId)}`),
  );
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ clubSlug: string; playerId: string }>;
}) {
  const [{ clubSlug, playerId }, locale] = await Promise.all([
    params,
    getLocale(),
  ]);
  const club = requireActiveClub(clubSlug);
  const messages = getMessages(locale);
  let player;
  try {
    player = await new AdminPlayerHistoryService().get(
      decodeURIComponent(playerId),
      club.teamId,
    );
  } catch {
    console.error("Player profile is temporarily unavailable.");
    player = null;
  }
  if (player === undefined) notFound();
  return (
    <AppShell
      locale={locale}
      messages={messages}
      club={club}
      currentHref={clubPath(club, "/players")}
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {player ? (
          <PlayerProfile
            club={club}
            player={player}
            locale={locale}
            messages={messages.players}
          />
        ) : (
          <section className="card p-6 text-center">
            <h1 className="score-font text-2xl">
              {messages.players.profileUnavailable}
            </h1>
          </section>
        )}
      </main>
    </AppShell>
  );
}
