import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { EmptyRatingState } from "@/components/empty-rating-state";
import { MatchLifecyclePanel } from "@/components/match-lifecycle-panel";
import type { Club } from "@/config/club";
import { requireClub } from "@/config/club-server";
import { buildPageMetadata } from "@/config/site";
import { communityName } from "@/config/community";
import type { Match } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { getPublicHomeMatch } from "@/lib/firebase/lifecycle-read";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: PageProps<"/[clubSlug]">): Promise<Metadata> {
  const { clubSlug } = await params;
  const club = requireClub(clubSlug);
  return {
    ...buildPageMetadata(`/${club.slug}`, {
      title: club.displayName,
      description:
        club.publicAvailability === "active"
          ? `Calificaciones de la afición de ${club.displayName}.`
          : `La cobertura de ${club.displayName} estará disponible próximamente.`,
    }),
    ...(club.publicAvailability === "active"
      ? {}
      : { robots: { index: false, follow: false } }),
  };
}

export default async function Home({ params }: PageProps<"/[clubSlug]">) {
  const { clubSlug } = await params;
  const club = requireClub(clubSlug);
  const locale = await getLocale();
  if (club.publicAvailability !== "active") {
    return <HomeContent club={club} locale={locale} unavailable />;
  }
  const now = new Date();
  let match: Match | null = null;
  let unavailable = false;
  try {
    match = await getPublicHomeMatch(club.teamId);
  } catch {
    unavailable = true;
    console.error("Home lifecycle data is temporarily unavailable.");
  }
  return (
    <HomeContent
      locale={locale}
      club={club}
      match={match}
      unavailable={unavailable}
      now={now}
    />
  );
}

export function HomeContent({
  club,
  locale,
  match = null,
  unavailable = false,
  now = new Date(),
}: {
  club: Club;
  locale: Locale;
  match?: Match | null;
  unavailable?: boolean;
  now?: Date;
}) {
  const messages = getMessages(locale);
  return (
    <AppShell locale={locale} messages={messages} club={club}>
      <main id="main-content" className="page-shell py-7 sm:py-10">
        <section aria-labelledby="club-heading" className="mb-7">
          <p className="eyebrow community-name break-words">
            {club.slug === "herediano" ? communityName : "Rating App"}
          </p>
          <h1
            id="club-heading"
            className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl"
          >
            {club.displayName}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
            {club.publicAvailability === "active"
              ? messages.home.introduction
              : messages.clubs.comingSoon}
          </p>
        </section>
        {club.publicAvailability !== "active" ? (
          <EmptyRatingState messages={messages.clubs.unavailable} />
        ) : match === null ? (
          <EmptyRatingState
            messages={
              unavailable
                ? messages.home.lifecycleUnavailable
                : messages.home.noActiveRating
            }
          />
        ) : (
          <MatchLifecyclePanel
            match={match}
            club={club}
            locale={locale}
            messages={messages.home.matchLifecycle}
            goalMessages={messages.matches}
            now={now}
          />
        )}
      </main>
    </AppShell>
  );
}
