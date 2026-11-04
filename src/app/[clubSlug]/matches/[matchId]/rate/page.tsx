import { AppShell } from "@/components/app-shell";
import { BallotRouteState } from "@/components/ballot-route-state";
import { RatingBallot } from "@/components/rating-ballot";
import { requireActiveClub } from "@/config/club-server";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminBallotService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RateMatchPage({
  params,
}: {
  params: Promise<{ clubSlug: string; matchId: string }>;
}) {
  const { clubSlug, matchId } = await params;
  const club = requireActiveClub(clubSlug);
  const locale = await getLocale();
  const messages = getMessages(locale);
  let pageState: Awaited<ReturnType<AdminBallotService["getPageState"]>> = {
    state: "unavailable",
  };
  try {
    pageState = await new AdminBallotService().getPageState(
      matchId,
      club.teamId,
    );
  } catch {
    console.error("Ballot page data is temporarily unavailable.", { matchId });
  }
  return (
    <AppShell
      locale={locale}
      messages={messages}
      club={club}
      currentHref={null}
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {pageState.state === "active" ? (
          <RatingBallot
            club={club}
            context={pageState.context}
            locale={locale}
            messages={messages.ballot}
          />
        ) : (
          <BallotRouteState
            club={club}
            matchId={matchId}
            state={pageState.state}
            messages={messages.ballot}
          />
        )}
      </main>
    </AppShell>
  );
}
