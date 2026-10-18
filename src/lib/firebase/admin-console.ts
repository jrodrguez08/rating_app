import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { initialClub } from "@/config/club";
import type {
  Coach,
  CoachAssignment,
  Match,
  VerifiedCoachAssignment,
} from "@/domain/models";
import { getServerFirestore } from "@/lib/firebase/server";

export interface AdminBlockedMatch {
  id: string;
  externalFixtureId: string;
  kickoffAt: string;
  homeTeamName: string;
  awayTeamName: string;
  diagnostic?: Match["ratingBlockReason"];
  diagnosticObservedAt?: string;
  participantCount: number;
  rateableParticipantCount: number;
  assignment?: Pick<CoachAssignment, "coachId" | "coachName" | "provenance">;
  verification?: Pick<
    VerifiedCoachAssignment,
    "coachId" | "verificationSource" | "verificationReason" | "verifiedAt"
  >;
}

export interface AdminCoachOption {
  id: string;
  name: string;
  provenance: Coach["identityProvenance"];
  externalProviderId?: string;
}

export interface AdminOverview {
  matches: AdminBlockedMatch[];
  coaches: AdminCoachOption[];
}

export class AdminConsoleService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async overview(): Promise<AdminOverview> {
    const [matchesSnapshot, coachesSnapshot] = await Promise.all([
      this.database
        .collection("matches")
        .where("trackedTeamId", "==", initialClub.teamId)
        .orderBy("kickoffAt", "desc")
        .limit(30)
        .get(),
      this.database
        .collection("coaches")
        .orderBy("updatedAt", "desc")
        .limit(100)
        .get(),
    ]);
    const matches = matchesSnapshot.docs
      .map((snapshot) => fromSnapshot<Match>(snapshot))
      .filter(
        (match) =>
          match.status === "finished" &&
          match.ratingState === "preparing_rating",
      )
      .slice(0, 10);
    return {
      matches: await Promise.all(
        matches.map((match) => this.describeMatch(match)),
      ),
      coaches: coachesSnapshot.docs.map((snapshot) => {
        const coach = fromSnapshot<Coach>(snapshot);
        return {
          id: coach.id,
          name: coach.displayName,
          provenance: coach.identityProvenance,
          ...(coach.externalProviderId
            ? { externalProviderId: coach.externalProviderId }
            : {}),
        };
      }),
    };
  }

  private async describeMatch(match: Match): Promise<AdminBlockedMatch> {
    const participants = this.database.collection(
      `matches/${match.id}/participants`,
    );
    const [assignment, verification, total, rateable] = await Promise.all([
      this.database
        .doc(`matches/${match.id}/coachAssignments/head-coach`)
        .get(),
      this.database
        .doc(`matches/${match.id}/verifiedCoachAssignments/head-coach`)
        .get(),
      participants.count().get(),
      participants
        .where("teamId", "==", match.trackedTeamId)
        .where("participated", "==", true)
        .count()
        .get(),
    ]);
    const current = assignment.exists
      ? fromSnapshot<CoachAssignment>(assignment)
      : undefined;
    const verified = verification.exists
      ? fromSnapshot<VerifiedCoachAssignment>(verification)
      : undefined;
    return {
      id: match.id,
      externalFixtureId: match.externalProviderFixtureId,
      kickoffAt: match.kickoffAt,
      homeTeamName: match.homeTeam.name,
      awayTeamName: match.awayTeam.name,
      diagnostic: match.ratingBlockReason,
      diagnosticObservedAt: match.ratingBlockObservedAt,
      participantCount: total.data().count,
      rateableParticipantCount: rateable.data().count,
      ...(current
        ? {
            assignment: {
              coachId: current.coachId,
              coachName: current.coachName,
              provenance: current.provenance,
            },
          }
        : {}),
      ...(verified
        ? {
            verification: {
              coachId: verified.coachId,
              verificationSource: verified.verificationSource,
              verificationReason: verified.verificationReason,
              verifiedAt: verified.verifiedAt,
            },
          }
        : {}),
    };
  }
}

function fromSnapshot<T>(snapshot: {
  id: string;
  data(): Record<string, unknown> | undefined;
}): T {
  const data = snapshot.data() ?? {};
  return {
    ...Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof Timestamp ? value.toDate().toISOString() : value,
      ]),
    ),
    id: snapshot.id,
  } as T;
}
