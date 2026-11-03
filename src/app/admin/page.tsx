import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AdminConsole, AdminLogin } from "@/components/admin-console";
import { initialClub, resolveClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import { AdminConsoleService } from "@/lib/firebase/admin-console";
import { getServerFirestore } from "@/lib/firebase/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSession,
} from "@/lib/server/admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: getMessages("es").admin.title,
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminPage({
  searchParams,
}: {
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
  const messages = getMessages("es").admin;
  const cookieStore = await cookies();
  let authenticated = false;
  try {
    await verifyAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
    authenticated = true;
  } catch {
    authenticated = false;
  }
  const overview = authenticated
    ? await new AdminConsoleService().overview(club.teamId)
    : null;
  const teamAvailable = overview
    ? (await getServerFirestore().doc(`teams/${club.teamId}`).get()).exists
    : false;
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
      <header className="mb-8">
        <p className="eyebrow">{messages.eyebrow}</p>
        <h1 className="score-font mt-2 text-3xl">{messages.title}</h1>
        <p className="text-muted mt-3 max-w-2xl">{messages.description}</p>
      </header>
      {overview ? (
        <AdminConsole
          key={club.slug}
          overview={overview}
          messages={messages}
          club={club}
          teamAvailable={teamAvailable}
        />
      ) : (
        <AdminLogin messages={messages} />
      )}
    </main>
  );
}
