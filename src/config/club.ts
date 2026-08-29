import type { TeamPresentation } from "@/domain/models";
import initialTeam from "../../firebase/seed/initial-team.json";

/** Presentation configuration only; Herediano is not embedded in domain models. */
export const initialClub: TeamPresentation = {
  teamId: initialTeam.id,
  displayName: initialTeam.displayName,
  shortName: initialTeam.shortName,
  theme: { primary: "#b20d24", accent: "#f5c518" },
};
