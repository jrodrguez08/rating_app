import type {
  DocumentReference,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";

import {
  evaluateWrappedCoverage,
  observeWrappedFixture,
  wrappedScopeVerified,
} from "@/application/wrapped-coverage";
import type { WrappedLedger } from "@/application/wrapped-ledger";
import type {
  Competition,
  Match,
  MatchResult,
  Season,
  Team,
} from "@/domain/models";
import { fromDocument } from "@/lib/firebase/firestore-document";

const READ_BATCH_SIZE = 50;

export function previewWrappedCoverage(
  database: Firestore,
  ledger: WrappedLedger,
  tournamentKey: string,
  asOf: Date,
) {
  const tournament = ledger.tournaments.find(
    ({ key }) => key === tournamentKey,
  );
  if (!tournament)
    throw new Error(
      "Tournament key does not exist in the reviewed Team ledger.",
    );
  if (!Number.isFinite(asOf.getTime()))
    throw new Error("Invalid preview time.");

  return database.runTransaction(
    async (transaction) => {
      const [teamDoc, competitionDoc, seasonDoc] = await transaction.getAll(
        database.doc("teams/" + ledger.teamId),
        database.doc("competitions/" + tournament.competitionId),
        database.doc("seasons/" + tournament.seasonId),
      );
      const scope = {
        team: teamDoc.exists ? fromDocument<Team>(teamDoc) : undefined,
        competition: competitionDoc.exists
          ? fromDocument<Competition>(competitionDoc)
          : undefined,
        season: seasonDoc.exists ? fromDocument<Season>(seasonDoc) : undefined,
      };
      const matches = new Map<string, Match>();
      const summaries = new Map<string, MatchResult>();
      if (
        scope.team &&
        wrappedScopeVerified(ledger.teamId, tournament, scope)
      ) {
        await readBatches(
          transaction,
          tournament.fixtures.map(({ matchId }) =>
            database.doc("matches/" + matchId),
          ),
          matches,
        );

        const team = scope.team;
        const summaryRefs = tournament.fixtures
          .filter(
            (fixture) =>
              observeWrappedFixture(
                fixture,
                tournament,
                team,
                matches.get(fixture.matchId),
                undefined,
                asOf,
              ).status === "summary_missing",
          )
          .map(({ matchId }) =>
            database.doc("matches/" + matchId + "/results/summary"),
          );
        await readBatches(transaction, summaryRefs, summaries, true);
      }
      return evaluateWrappedCoverage({
        ledger,
        tournament,
        scope,
        matches,
        summaries,
        asOf,
      });
    },
    { readOnly: true },
  );
}

async function readBatches<T>(
  transaction: Transaction,
  references: DocumentReference[],
  target: Map<string, T>,
  parentMatch = false,
) {
  for (let offset = 0; offset < references.length; offset += READ_BATCH_SIZE) {
    const batch = references.slice(offset, offset + READ_BATCH_SIZE);
    for (const snapshot of await transaction.getAll(...batch)) {
      if (!snapshot.exists) continue;
      const key = parentMatch ? snapshot.ref.parent.parent!.id : snapshot.id;
      target.set(key, fromDocument<T>(snapshot));
    }
  }
}
