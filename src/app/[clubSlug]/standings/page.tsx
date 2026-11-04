import type { Metadata } from "next";

import { buildStandingsView } from "@/application/standings";
import { AppShell } from "@/components/app-shell";
import { StandingsTable } from "@/components/standings-table";
import { clubPath } from "@/config/club";
import { requireActiveClub } from "@/config/club-server";
import { buildPageMetadata } from "@/config/site";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminStandingsService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function generateMetadata({
  params,
}: PageProps<"/[clubSlug]/standings">): Promise<Metadata> {
  const { clubSlug } = await params;
  const club = requireActiveClub(clubSlug);
  return buildPageMetadata(clubPath(club, "/standings"), {
    title: "Tabla de posiciones",
    description: `Tabla diaria de la Primera División para la afición de ${club.shortName}.`,
  });
}

export default async function StandingsPage({
  params,
}: PageProps<"/[clubSlug]/standings">) {
  const { clubSlug } = await params;
  const club = requireActiveClub(clubSlug);
  const locale = await getLocale();
  const messages = getMessages(locale);
  let standings = null;
  try {
    const persisted = await new AdminStandingsService().get(club.teamId);
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
      club={club}
      currentHref={clubPath(club, "/standings")}
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
