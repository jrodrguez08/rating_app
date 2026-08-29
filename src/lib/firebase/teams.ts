import { doc, getDoc, type Firestore } from "firebase/firestore";

import type { Team } from "@/domain/models";
import { initialClub } from "@/config/club";

import { teamFromDocument } from "./team-document";

export async function getTeamById(
  database: Firestore,
  teamId: string,
): Promise<Team | null> {
  const snapshot = await getDoc(doc(database, "teams", teamId));
  return snapshot.exists()
    ? teamFromDocument(snapshot.id, snapshot.data())
    : null;
}

export function getInitialTeam(database: Firestore): Promise<Team | null> {
  return getTeamById(database, initialClub.teamId);
}
