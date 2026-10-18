import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AdminConsole, AdminLogin } from "@/components/admin-console";
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
  title: getMessages("es").admin.title,
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminPage() {
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
    ? await new AdminConsoleService().overview()
    : null;
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
        <h1 className="score-font mt-2 text-3xl">{messages.title}</h1>
        <p className="text-muted mt-3 max-w-2xl">{messages.description}</p>
      </header>
      {overview ? (
        <AdminConsole
          overview={overview}
          messages={messages}
          teamId={initialClub.teamId}
        />
      ) : (
        <AdminLogin messages={messages} />
      )}
    </main>
  );
}
