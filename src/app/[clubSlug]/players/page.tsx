import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { PlayerCatalogView } from "@/components/player-history";
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
}: PageProps<"/[clubSlug]/players">): Promise<Metadata> {
  const { clubSlug } = await params;
  const club = requireActiveClub(clubSlug);
  return buildPageMetadata(clubPath(club, "/players"), {
    title: "Jugadores",
    description: "Calificaciones de la afición en los partidos publicados.",
  });
}

export default async function PlayersPage({
  params,
}: PageProps<"/[clubSlug]/players">) {
  const { clubSlug } = await params;
  const club = requireActiveClub(clubSlug);
  const locale = await getLocale();
  const messages = getMessages(locale);
  let catalog = null;
  try {
    catalog = await new AdminPlayerHistoryService().list(club.teamId);
  } catch {
    console.error("Player history is temporarily unavailable.");
  }
  return (
    <AppShell
      locale={locale}
      messages={messages}
      club={club}
      currentHref={clubPath(club, "/players")}
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {catalog ? (
          <PlayerCatalogView
            club={club}
            catalog={catalog}
            locale={locale}
            messages={messages.players}
          />
        ) : (
          <section
            className="card p-6 text-center"
            aria-labelledby="players-unavailable-heading"
          >
            <h1
              id="players-unavailable-heading"
              className="score-font text-2xl"
            >
              {messages.players.unavailableTitle}
            </h1>
            <p className="mt-3 text-muted">
              {messages.players.unavailableDescription}
            </p>
          </section>
        )}
      </main>
    </AppShell>
  );
}
