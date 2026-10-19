import Link from "next/link";

export function AdminDashboardLink({ label }: { label: string }) {
  return (
    <Link
      className="button-secondary mb-6 inline-flex min-h-11 items-center px-4"
      href="/admin"
    >
      {label}
    </Link>
  );
}
