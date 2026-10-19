import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AdminLineupEditor } from "@/components/admin-lineup-editor";
import { AdminMatchCoachPanel } from "@/components/admin-match-coach";
import { AdminManualVotingPanel } from "@/components/admin-manual-voting";
import { initialClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import { AdminConsoleService } from "@/lib/firebase/admin-console";
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
}: {
  params: Promise<{ matchId: string }>;
}) {
  const cookieStore = await cookies();
  let ownerId: string;
  try {
    ownerId = (
      await verifyAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
    ).uid;
  } catch {
    redirect("/admin");
  }
  const { matchId } = await params;
  const detail = await new AdminConsoleService().detail(matchId, ownerId);
  if (!detail) notFound();
  const messages = getMessages("es").admin;
  return (
    <main
      className="page-shell py-8"
      style={
        {
          "--club-primary": initialClub.theme.primary,
          "--club-secondary": initialClub.theme.accent,
        } as React.CSSProperties
      }
    >
      <header className="mb-8">
        <p className="eyebrow">{messages.eyebrow}</p>
        <h1 className="score-font mt-2 text-3xl">{messages.lineupTitle}</h1>
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
            detail={detail}
            messages={messages}
            teamId={initialClub.teamId}
          />
        )}
        {detail.match.verification ? (
          <section className="card grid gap-3 p-5">
            <p className="eyebrow">3 / 4</p>
            <h2 className="score-font text-xl">{messages.coach}</h2>
            <p className="text-success" role="status">
              ✓{" "}
              {detail.match.assignment?.coachName ??
                detail.coaches?.find(
                  (coach) => coach.id === detail.match.verification?.coachId,
                )?.name ??
                messages.verifiedAssignment}
            </p>
          </section>
        ) : (
          <AdminMatchCoachPanel
            detail={detail}
            messages={messages}
            teamId={initialClub.teamId}
          />
        )}
        <AdminManualVotingPanel
          detail={detail}
          messages={messages}
          teamId={initialClub.teamId}
        />
      </div>
    </main>
  );
}
