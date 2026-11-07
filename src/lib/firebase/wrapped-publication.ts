import type { Firestore, Transaction } from "firebase-admin/firestore";

import {
  WRAPPED_SNAPSHOT_SCHEMA,
  wrappedEditionId,
  type WrappedProjection,
} from "@/application/wrapped-snapshot";
import { resolveClub } from "@/config/club";
import { publicClub } from "@/config/club-operations";
import { wrappedLocalEnabled } from "@/lib/server/wrapped-local";

export interface WrappedPublication {
  teamId: string;
  tournamentKey: string;
  epoch: number;
  lastVersion: number;
  active: { version: number; digest: string } | null;
}

export function publicationRef(database: Firestore, editionId: string) {
  return database.doc(`wrappedPublications/${editionId}`);
}

export function wrappedDependencyRef(database: Firestore, matchId: string) {
  return database.doc(`wrappedMatchDependencies/${matchId}`);
}

export async function invalidateWrappedForMatch(
  database: Firestore,
  transaction: Transaction,
  matchId: string,
  teamId: string,
) {
  if (!wrappedLocalEnabled()) return;
  const dependency = (
    await transaction.get(wrappedDependencyRef(database, matchId))
  ).data();
  if (!dependency) return;
  if (
    dependency.teamId !== teamId ||
    typeof dependency.tournamentKey !== "string"
  )
    throw new Error("Wrapped dependency binding is invalid.");
  const reference = publicationRef(
    database,
    wrappedEditionId(teamId, dependency.tournamentKey),
  );
  const publication = (await transaction.get(reference)).data() as
    WrappedPublication | undefined;
  if (
    publication?.active?.version !== dependency.version ||
    !publication?.active
  )
    return;
  if (
    publication.teamId !== teamId ||
    publication.tournamentKey !== dependency.tournamentKey
  )
    throw new Error("Wrapped publication binding is invalid.");
  transaction.update(reference, {
    active: null,
    epoch: publication.epoch + 1,
    invalidatedBy: matchId,
  });
}

export async function readWrappedProjection(
  database: Firestore,
  clubSlug: string,
  tournamentKey: string,
  allowedEditionIds: ReadonlySet<string>,
): Promise<{ version: number; projection: WrappedProjection } | null> {
  const club = resolveClub(clubSlug);
  if (
    !wrappedLocalEnabled() ||
    !club ||
    publicClub(club.slug).publicAvailability !== "active"
  )
    return null;
  const editionId = wrappedEditionId(club.teamId, tournamentKey);
  if (!allowedEditionIds.has(editionId)) return null;
  return database.runTransaction(
    async (transaction) => {
      const reference = publicationRef(database, editionId);
      const publication = (await transaction.get(reference)).data() as
        WrappedPublication | undefined;
      const active = publication?.active;
      if (
        !active ||
        publication.teamId !== club.teamId ||
        publication.tournamentKey !== tournamentKey
      )
        return null;
      const document = (
        await transaction.get(
          reference.collection("projections").doc(String(active.version)),
        )
      ).data();
      if (
        !document ||
        document.schema !== WRAPPED_SNAPSHOT_SCHEMA ||
        document.digest !== active.digest ||
        document.version !== active.version ||
        typeof document.body !== "string"
      )
        return null;
      let projection: WrappedProjection;
      try {
        projection = JSON.parse(document.body) as WrappedProjection;
      } catch {
        return null;
      }
      if (
        projection?.teamId !== club.teamId ||
        projection.clubSlug !== clubSlug ||
        projection.tournament?.key !== tournamentKey
      )
        return null;
      return { version: active.version, projection };
    },
    { readOnly: true },
  );
}
