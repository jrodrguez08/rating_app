import type { SVGProps } from "react";

type GameIconProps = Omit<SVGProps<SVGSVGElement>, "children">;

export function ChevronDownIcon(props: GameIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      shapeRendering="crispEdges"
      {...props}
    >
      <path d="M3 5h2v2h2v2h2V7h2V5h2v4h-2v2H9v2H7v-2H5V9H3z" />
    </svg>
  );
}

export function StatusPanelIcon(props: GameIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      shapeRendering="crispEdges"
      {...props}
    >
      <path d="M5 1h6v2h2v2h2v6h-2v2h-2v2H5v-2H3v-2H1V5h2V3h2zm1 3v5h4V7H8V4z" />
    </svg>
  );
}
