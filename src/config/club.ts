import type { TeamPresentation } from "@/domain/models";

/** Presentation configuration only; Herediano is not embedded in domain models. */
export const initialClub: TeamPresentation = {
  teamId: "club-sport-herediano",
  displayName: "Club Sport Herediano",
  shortName: "Herediano",
  theme: { primary: "#b20d24", accent: "#f5c518" },
};
