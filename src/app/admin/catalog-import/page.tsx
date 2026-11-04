import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AdminCatalogImport } from "@/components/admin-catalog-import";
import { adminPath, initialClub, resolveClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSession,
} from "@/lib/server/admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: getMessages("es").admin.catalogImport.title,
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminCatalogImportPage({
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
      <AdminCatalogImport
        club={club}
        messages={getMessages("es").admin.catalogImport}
        positionNames={getMessages("es").players.positions}
      />
    </main>
  );
}
