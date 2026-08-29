import { AppShell } from "@/components/app-shell";
import { MatchResults, ResultRouteState } from "@/components/match-results";
import { initialClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { AdminResultService } from "@/lib/firebase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MatchResultsPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const locale = await getLocale();
  const messages = getMessages(locale);
  const { matchId } = await params;
  let pageState: Awaited<ReturnType<AdminResultService["getPageState"]>> = {
    state: "unavailable",
  };
  try {
    pageState = await new AdminResultService().getPageState(matchId);
  } catch {
    console.error("Result page data is temporarily unavailable.", { matchId });
  }
  return (
    <AppShell
      locale={locale}
      messages={messages}
      theme={initialClub.theme}
      currentHref={null}
    >
      <main id="main-content" className="page-shell py-7 sm:py-10">
        {pageState.state === "ready" ? (
          <MatchResults
            match={pageState.match}
            result={pageState.result}
            locale={locale}
            messages={messages.results}
          />
        ) : (
          <ResultRouteState
            state={pageState.state}
            messages={messages.results}
          />
        )}
      </main>
    </AppShell>
  );
}
