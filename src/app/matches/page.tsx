import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { MatchArchiveView } from "@/components/match-archive";
import { initialClub } from "@/config/club";
import { buildPageMetadata } from "@/config/site";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminMatchArchiveService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = buildPageMetadata("/matches", {
  title: "Partidos",
  description: "Próximos partidos, marcadores y resultados recientes.",
});

export default async function MatchesPage() {
  const locale = await getLocale();
  const messages = getMessages(locale);
  let archive = null;
  try {
    archive = await new AdminMatchArchiveService().list(initialClub.teamId);
  } catch {
    console.error("Match archive is temporarily unavailable.");
  }
  return (
    <AppShell
      locale={locale}
      messages={messages}
      theme={initialClub.theme}
      currentHref="/matches"
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {archive ? (
          <MatchArchiveView
            archive={archive}
            locale={locale}
            messages={messages.matches}
            ballotMessages={messages.home.matchLifecycle.ready}
            now={new Date()}
          />
        ) : (
          <section
            className="card p-6 text-center"
            aria-labelledby="matches-unavailable-heading"
          >
            <h1
              id="matches-unavailable-heading"
              className="score-font text-2xl"
            >
              {messages.matches.unavailableTitle}
            </h1>
            <p className="mt-3 text-muted">
              {messages.matches.unavailableDescription}
            </p>
          </section>
        )}
      </main>
    </AppShell>
  );
}
