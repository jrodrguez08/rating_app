import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminIdentityReconciliation } from "@/components/admin-identity-reconciliation";
import { initialClub } from "@/config/club";
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

export default async function AdminPlayerIdentityPage() {
  const cookieStore = await cookies();
  try {
    await verifyAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  } catch {
    redirect("/admin");
  }
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
      <AdminIdentityReconciliation
        messages={messages}
        teamId={initialClub.teamId}
        teamName={initialClub.displayName}
      />
    </main>
  );
}
