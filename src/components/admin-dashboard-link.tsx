import Link from "next/link";

import { adminPath, type Club } from "@/config/club";

export function AdminDashboardLink({
  label,
  club,
}: {
  label: string;
  club: Club;
}) {
  return (
    <Link
      className="button-secondary mb-6 inline-flex min-h-11 items-center px-4"
      href={adminPath(club)}
    >
      {label}
    </Link>
  );
}
