import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AdminDashboardLink } from "@/components/admin-dashboard-link";
import { AdminLineupEditor } from "@/components/admin-lineup-editor";
import { AdminMatchCoachPanel } from "@/components/admin-match-coach";
import { AdminManualVotingPanel } from "@/components/admin-manual-voting";
import { AdminProviderCheck } from "@/components/admin-provider-check";
import { adminPath, initialClub, resolveClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import { AdminConsoleService } from "@/lib/firebase/admin-console";
import { AdminProviderCheckService } from "@/lib/firebase/admin-provider-check";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSession,
} from "@/lib/server/admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: getMessages("es").admin.lineupTitle,
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminMatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{ club?: string | string[] }>;
}) {
  const requestedClub = (await searchParams).club;
  const club =
    requestedClub === undefined
      ? initialClub
      : typeof requestedClub === "string"
        ? resolveClub(requestedClub)
        : null;
  if (!club) notFound();
  const cookieStore = await cookies();
  let ownerId: string;
  try {
    ownerId = (
      await verifyAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
    ).uid;
  } catch {
    redirect(adminPath(club));
  }
  const { matchId } = await params;
  const detail = await new AdminConsoleService().detail(
    matchId,
    club.teamId,
    ownerId,
  );
  if (!detail) notFound();
  const messages = getMessages("es").admin;
  const persistedProviderReport =
    detail.match.ratingState === "rating_closed"
      ? await new AdminProviderCheckService().readPersisted({
          matchId: detail.match.id,
          trackedTeamId: club.teamId,
          externalFixtureId: detail.match.externalFixtureId,
        })
      : null;
  return (
    <main
      className="page-shell py-8"
      style={
        {
          "--club-primary": club.theme.primary,
          "--club-secondary": club.theme.accent,
        } as React.CSSProperties
      }
    >
      <AdminDashboardLink label={messages.backToDashboard} club={club} />
      <header className="mb-8">
        <p className="eyebrow">{messages.eyebrow}</p>
        <h1 className="score-font mt-2 text-3xl">{messages.lineupTitle}</h1>
        <p className="text-muted mt-2">{club.displayName}</p>
        <p className="text-muted mt-3 max-w-2xl">
          {messages.lineupDescription}
        </p>
      </header>
      <div className="grid gap-6">
        {detail.match.verifiedLineup ? (
          <section className="card grid gap-3 p-5">
            <p className="eyebrow">1–2 / 4</p>
            <h2 className="score-font text-xl">{messages.playerSelection}</h2>
            <p className="text-success" role="status">
              ✓ {messages.confirmedStarters}:{" "}
              {detail.match.confirmedStarterCount}/11
              {" · "}
              {messages.confirmedSubstitutes}:{" "}
              {detail.match.confirmedSubstituteCount}
            </p>
          </section>
        ) : (
          <AdminLineupEditor
            key={`${club.slug}:${detail.match.id}`}
            detail={detail}
            messages={messages}
            teamId={club.teamId}
          />
        )}
        {detail.match.verification ? (
          <section className="card grid gap-3 p-5">
            <p className="eyebrow">3 / 4</p>
            <h2 className="score-font text-xl">{messages.coach}</h2>
            <p className="text-success" role="status">
              ✓{" "}
              {detail.match.assignment?.coachName ??
                detail.currentCoach?.name ??
                messages.verifiedAssignment}
            </p>
          </section>
        ) : (
          <AdminMatchCoachPanel
            key={`${club.slug}:${detail.match.id}`}
            detail={detail}
            messages={messages}
            teamId={club.teamId}
          />
        )}
        <AdminManualVotingPanel
          key={`${club.slug}:${detail.match.id}`}
          detail={detail}
          messages={messages}
          teamId={club.teamId}
        />
        <AdminProviderCheck
          key={`${club.slug}:${detail.match.id}`}
          match={detail.match}
          messages={messages}
          teamId={club.teamId}
          initialReport={persistedProviderReport}
        />
      </div>
    </main>
  );
}
