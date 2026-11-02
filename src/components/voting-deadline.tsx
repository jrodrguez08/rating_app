import type { Locale } from "@/i18n/config";
import { formatVotingDeadline } from "@/i18n/format";

export function VotingDeadline({
  closesAt,
  locale,
  label,
  timeZoneLabel,
  className,
}: {
  closesAt: string;
  locale: Locale;
  label: string;
  timeZoneLabel: string;
  className?: string;
}) {
  return (
    <p className={className}>
      <span className="font-bold">{label}:</span>{" "}
      <time dateTime={closesAt}>
        {formatVotingDeadline(closesAt, locale)} ({timeZoneLabel})
      </time>
    </p>
  );
}
