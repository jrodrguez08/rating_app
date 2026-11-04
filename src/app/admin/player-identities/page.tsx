import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AdminIdentityReconciliation } from "@/components/admin-identity-reconciliation";
import { adminPath, initialClub, resolveClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSession,
} from "@/lib/server/admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: getMessages("es").admin.identityReconciliationTitle,
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminPlayerIdentityPage({
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
  const cookieStore = await cookies();
  try {
    await verifyAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  } catch {
    redirect(adminPath(club));
  }
  const messages = getMessages("es").admin;
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
      <AdminIdentityReconciliation
        key={club.slug}
        messages={messages}
        teamId={club.teamId}
        teamName={club.displayName}
      />
    </main>
  );
}
