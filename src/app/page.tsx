import { AppShell } from "@/components/app-shell";
import { EmptyRatingState } from "@/components/empty-rating-state";
import { initialClub } from "@/config/club";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";

export default async function Home() {
  return <HomeContent locale={await getLocale()} />;
}

export function HomeContent({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  return (
    <AppShell locale={locale} messages={messages}>
      <main id="main-content" className="page-shell py-8 sm:py-12">
        <section aria-labelledby="club-heading" className="mb-8">
          <p className="eyebrow">{messages.home.communityEyebrow}</p>
          <h1
            id="club-heading"
            className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl"
          >
            {initialClub.displayName}
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-muted">
            {messages.home.introduction}
          </p>
        </section>
        <EmptyRatingState messages={messages.home.noActiveRating} />
      </main>
    </AppShell>
  );
}
