import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PlayerProfile } from "@/components/player-history";
import { initialClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminPlayerHistoryService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const [{ playerId }, locale] = await Promise.all([params, getLocale()]);
  const messages = getMessages(locale);
  let player;
  try {
    player = await new AdminPlayerHistoryService().get(
      decodeURIComponent(playerId),
      initialClub.teamId,
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
      theme={initialClub.theme}
      currentHref="/players"
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {player ? (
          <PlayerProfile
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
