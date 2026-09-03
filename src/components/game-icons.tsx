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

export function WhatsAppIcon(props: GameIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <path d="M13.5 7.5a5.5 5.5 0 0 1-8.2 4.8L2 13.5l1.2-3.2A5.5 5.5 0 1 1 13.5 7.5Z" />
      <path d="M5.4 4.8c.3-.3.7-.1.9.3l.6 1.3c.1.3 0 .5-.3.8l-.4.4c.6 1.1 1.3 1.8 2.4 2.3l.4-.5c.2-.3.5-.4.8-.2l1.2.6c.4.2.5.6.2.9-.5.6-1.2.9-2 .7-2.7-.7-4.8-2.8-5.5-5.5-.2-.5.2-.8.7-1.1Z" />
    </svg>
  );
}
