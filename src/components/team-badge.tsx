import type { CSSProperties } from "react";

import type { TeamBadgePresentation } from "@/config/team-badges";

type BadgeStyle = CSSProperties & {
  "--badge-primary": string;
  "--badge-secondary": string;
};

export function TeamBadge({
  presentation,
}: {
  presentation: TeamBadgePresentation;
}) {
  const style: BadgeStyle = {
    "--badge-primary": presentation.primary,
    "--badge-secondary": presentation.secondary,
  };
  return (
    <span
      aria-hidden="true"
      className={`team-badge team-badge--${presentation.pattern}`}
      data-testid="team-badge"
      style={style}
    >
      <span className="team-badge__field" />
      <span className="team-badge__initials">{presentation.abbreviation}</span>
    </span>
  );
}
