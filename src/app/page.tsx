import { AppShell } from "@/components/app-shell";
import { EmptyRatingState } from "@/components/empty-rating-state";
import { MatchLifecyclePanel } from "@/components/match-lifecycle-panel";
import { initialClub } from "@/config/club";
import type { Match } from "@/domain/models";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { getLifecycleHomeMatch } from "@/lib/firebase/lifecycle-read";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const locale = await getLocale();
  let match: Match | null = null;
  let unavailable = false;
  try {
    match = await getLifecycleHomeMatch(initialClub.teamId);
  } catch {
    unavailable = true;
    console.error("Home lifecycle data is temporarily unavailable.");
  }
  return (
    <HomeContent locale={locale} match={match} unavailable={unavailable} />
  );
}

export function HomeContent({
  locale,
  match = null,
  unavailable = false,
}: {
  locale: Locale;
  match?: Match | null;
  unavailable?: boolean;
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
            locale={locale}
            messages={messages.home.matchLifecycle}
          />
        )}
      </main>
    </AppShell>
  );
}
