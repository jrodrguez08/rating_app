import { AppShell } from "@/components/app-shell";
import { EmptyRatingState } from "@/components/empty-rating-state";
import { MatchLifecyclePanel } from "@/components/match-lifecycle-panel";
import { initialClub } from "@/config/club";
import type { Match } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { getLifecycleHomeMatch } from "@/lib/firebase/lifecycle-read";

export default async function Home() {
  const locale = await getLocale();
  let match: Match | null = null;
  try {
    match = await getLifecycleHomeMatch(initialClub.teamId);
  } catch {
    // The honest empty state remains available when server persistence is not configured.
  }
  return <HomeContent locale={locale} match={match} />;
}

export function HomeContent({
  locale,
  match = null,
}: {
  locale: Locale;
  match?: Match | null;
}) {
  const messages = getMessages(locale);
  return (
    <AppShell locale={locale} messages={messages} theme={initialClub.theme}>
      <main id="main-content" className="page-shell py-7 sm:py-10">
        <section aria-labelledby="club-heading" className="mb-7">
          <p className="eyebrow">{messages.home.communityEyebrow}</p>
          <h1
            id="club-heading"
            className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl"
          >
            {initialClub.displayName}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
            {messages.home.introduction}
          </p>
        </section>
        {match === null ? (
          <EmptyRatingState messages={messages.home.noActiveRating} />
        ) : (
          <MatchLifecyclePanel
            match={match}
            locale={locale}
            messages={messages.home.matchLifecycle}
          />
        )}
      </main>
    </AppShell>
  );
}
