import { AppShell } from "@/components/app-shell";
import { BallotRouteState } from "@/components/ballot-route-state";
import { RatingBallot } from "@/components/rating-ballot";
import { initialClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminBallotService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RateMatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const locale = await getLocale();
  const messages = getMessages(locale);
  const { matchId } = await params;
  let pageState: Awaited<ReturnType<AdminBallotService["getPageState"]>> = {
    state: "unavailable",
  };
  try {
    pageState = await new AdminBallotService().getPageState(matchId);
  } catch {
    console.error("Ballot page data is temporarily unavailable.", { matchId });
  }
  return (
    <AppShell
      locale={locale}
      messages={messages}
      theme={initialClub.theme}
      currentHref={null}
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {pageState.state === "active" ? (
          <RatingBallot
            context={pageState.context}
            locale={locale}
            messages={messages.ballot}
          />
        ) : (
          <BallotRouteState
            matchId={matchId}
            state={pageState.state}
            messages={messages.ballot}
          />
        )}
      </main>
    </AppShell>
  );
}
