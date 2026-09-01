import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { PlayerCatalogView } from "@/components/player-history";
import { initialClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminPlayerHistoryService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Jugadores",
  description: "Calificaciones de la afición en los partidos publicados.",
};

export default async function PlayersPage() {
  const locale = await getLocale();
  const messages = getMessages(locale);
  let catalog = null;
  try {
    catalog = await new AdminPlayerHistoryService().list(initialClub.teamId);
  } catch {
    console.error("Player history is temporarily unavailable.");
  }
  return (
    <AppShell
      locale={locale}
      messages={messages}
      theme={initialClub.theme}
      currentHref="/players"
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {catalog ? (
          <PlayerCatalogView catalog={catalog} messages={messages.players} />
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
