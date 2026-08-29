import { AppShell } from "@/components/app-shell";
import { EmptyRatingState } from "@/components/empty-rating-state";
import { initialClub } from "@/config/club";

export default function Home() {
  return <AppShell>
    <main id="main-content" className="page-shell py-8 sm:py-12">
      <section aria-labelledby="club-heading" className="mb-8">
        <p className="eyebrow">Initial supporter community</p>
        <h1 id="club-heading" className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{initialClub.displayName}</h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-muted">Rate the players and head coach after the final whistle. The first rating window will appear here when a match is ready.</p>
      </section>
      <EmptyRatingState />
    </main>
  </AppShell>;
}
