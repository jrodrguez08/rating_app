import type { Metadata } from "next";

import { buildStandingsView } from "@/application/standings";
import { AppShell } from "@/components/app-shell";
import { StandingsTable } from "@/components/standings-table";
import { initialClub } from "@/config/club";
import { buildPageMetadata } from "@/config/site";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminStandingsService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = buildPageMetadata("/standings", {
  title: "Tabla de posiciones",
  description: "Tabla diaria de la Primera División para la afición herediana.",
});

export default async function StandingsPage() {
  const locale = await getLocale();
  const messages = getMessages(locale);
  let standings = null;
  try {
    const persisted = await new AdminStandingsService().get(initialClub.teamId);
    standings =
      persisted === null
        ? null
        : buildStandingsView(
            persisted.snapshot,
            persisted.trackedTeamExternalProviderId,
          );
  } catch {
    console.error("Standings are temporarily unavailable.");
  }
  return (
    <AppShell
      locale={locale}
      messages={messages}
      theme={initialClub.theme}
      currentHref="/standings"
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        <StandingsTable
          standings={standings}
          locale={locale}
          messages={messages.standings}
        />
      </main>
    </AppShell>
  );
}
