import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

import saprissaTeam from "../../firebase/seed/saprissa-team.json";

export type ClubBootstrapOutcome = "create" | "map" | "unchanged";

export async function bootstrapSaprissaTeam(
  database: Firestore,
  providerTeamId: string,
  apply: boolean,
): Promise<ClubBootstrapOutcome> {
  if (!/^[1-9]\d*$/.test(providerTeamId)) {
    throw new Error("A positive provider Team ID is required.");
  }
  const reference = database.doc(`teams/${saprissaTeam.id}`);
  return database.runTransaction(async (transaction) => {
    const mapped = await transaction.get(
      database
        .collection("teams")
        .where("externalProviderId", "==", providerTeamId),
    );
    if (mapped.docs.some((document) => document.id !== saprissaTeam.id)) {
      throw new Error("Provider Team ID belongs to another canonical Team.");
    }
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) {
      const existing = snapshot.data();
      if (
        Object.entries(saprissaTeam).some(
          ([key, value]) => key !== "id" && existing?.[key] !== value,
        ) ||
        (existing?.externalProviderId !== undefined &&
          existing.externalProviderId !== providerTeamId)
      ) {
        throw new Error(
          "Existing Saprissa Team identity or mapping conflicts.",
        );
      }
      if (existing?.externalProviderId === providerTeamId) return "unchanged";
      if (apply) {
        transaction.update(reference, {
          externalProviderId: providerTeamId,
          updatedAt: Timestamp.now(),
        });
      }
      return "map";
    }
    if (apply) {
      const now = Timestamp.now();
      transaction.create(reference, {
        displayName: saprissaTeam.displayName,
        shortName: saprissaTeam.shortName,
        countryName: saprissaTeam.countryName,
        countryCode: saprissaTeam.countryCode,
        brandingKey: saprissaTeam.brandingKey,
        externalProviderId: providerTeamId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return "create";
  });
}
