import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { initialClub } from "@/config/club";
import type {
  AdminLineupDraft,
  Coach,
  CoachAssignment,
  Match,
  MatchParticipant,
  Player,
  VerifiedCoachAssignment,
  VerifiedLineupReconciliation,
  VerifiedLineupSnapshot,
} from "@/domain/models";
import { getServerFirestore } from "@/lib/firebase/server";
import {
  searchIndexedTeamPlayers,
  type TeamPlayerIndexObserver,
} from "@/lib/firebase/team-player-membership-index";

export interface AdminMatchOperation {
  id: string;
  externalFixtureId: string;
  kickoffAt: string;
  homeTeamName: string;
  awayTeamName: string;
  status: Match["status"];
  ratingState: Match["ratingState"];
  lineupSnapshotAt?: string;
  participantSyncedAt?: string;
  finishedObservedAt?: string;
  ratingReadyAt?: string;
  votingOpensAt?: string;
  lastProviderSyncAt?: string;
  lastLifecycleRequestedAt?: string;
  lastLifecycleStartedAt?: string;
  lastLifecycleCompletedAt?: string;
  lastLifecycleTrigger?: "scheduled" | "operator";
  lastLifecycleAction?: string;
  lastLifecycleProviderRequests?: number;
  diagnostic?: Match["ratingBlockReason"];
  diagnosticObservedAt?: string;
  participantCount: number;
  rateableParticipantCount: number;
  confirmedStarterCount: number;
  confirmedSubstituteCount: number;
  unconfirmedOrUnusedCount: number;
  headCoachReady: boolean;
  lineupProvenance: "provider" | "operator_verified" | "unavailable";
  assignment?: Pick<CoachAssignment, "coachId" | "coachName" | "provenance">;
  verification?: Pick<
    VerifiedCoachAssignment,
    "coachId" | "verificationSource" | "verificationReason" | "verifiedAt"
  >;
  verifiedLineup?: Pick<
    VerifiedLineupSnapshot,
    "verificationSource" | "verificationReason" | "operatorId" | "verifiedAt"
  >;
}

export interface AdminCoachOption {
  id: string;
  name: string;
  provenance: Coach["identityProvenance"];
  externalProviderId?: string;
}

export interface AdminOverview {
  upcomingLiveMatches: AdminMatchOperation[];
  attentionMatches: AdminMatchOperation[];
  votingCompletedMatches: AdminMatchOperation[];
  coaches: AdminCoachOption[];
}

export interface AdminPlayerOption {
  id: string;
  name: string;
  position?: Player["position"];
  photoUrl?: string;
  shirtNumber?: number;
  identityProvenance: "provider" | "operator_verified";
}

export interface AdminPlayerSearchPage {
  players: AdminPlayerOption[];
  nextCursor?: string;
}

export type AdminParticipantEvidence = Pick<
  MatchParticipant,
  | "playerId"
  | "playerName"
  | "squadRole"
  | "participated"
  | "participationStatus"
  | "shirtNumber"
  | "position"
  | "enteredAtMinute"
  | "identityProvenance"
  | "participationProvenance"
  | "verificationSource"
>;

export interface AdminMatchDetail {
  match: AdminMatchOperation;
  participants: AdminParticipantEvidence[];
  players: AdminPlayerOption[];
  coaches?: AdminCoachOption[];
  draft?: AdminLineupDraft;
  reconciliation?: VerifiedLineupReconciliation;
}

export class AdminConsoleService {
  constructor(
    private readonly database: Firestore = getServerFirestore(),
    private readonly observePlayerIndexRead?: TeamPlayerIndexObserver,
  ) {}

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
    const matches = matchesSnapshot.docs.map((snapshot) =>
      fromSnapshot<Match>(snapshot),
    );
    const described = await Promise.all(
      matches.map((match) => this.describeMatch(match)),
    );
    return {
      upcomingLiveMatches: described
        .filter((match) => ["scheduled", "live"].includes(match.status))
        .slice(0, 10),
      attentionMatches: described
        .filter(
          (match) =>
            match.status === "finished" &&
            match.ratingState === "preparing_rating",
        )
        .slice(0, 10),
      votingCompletedMatches: described
        .filter((match) =>
          ["rating_ready", "rating_closed"].includes(match.ratingState),
        )
        .slice(0, 10),
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

  async detail(
    matchId: string,
    ownerId?: string,
  ): Promise<AdminMatchDetail | null> {
    const matchSnapshot = await this.database.doc(`matches/${matchId}`).get();
    if (!matchSnapshot.exists) return null;
    const match = fromSnapshot<Match>(matchSnapshot);
    if (match.trackedTeamId !== initialClub.teamId) return null;
    const [
      participantSnapshot,
      verifiedSnapshot,
      metadataSnapshot,
      draftSnapshot,
      reconciliationSnapshot,
      coachesSnapshot,
    ] = await Promise.all([
      this.database.collection(`matches/${matchId}/participants`).get(),
      this.database.doc(`matches/${matchId}/verifiedLineups/current`).get(),
      this.database.doc(`footballSyncMetadata/${initialClub.teamId}`).get(),
      ownerId
        ? this.database.doc(`matches/${matchId}/lineupDrafts/${ownerId}`).get()
        : Promise.resolve(undefined),
      this.database
        .doc(`matches/${matchId}/lineupReconciliations/provider`)
        .get(),
      this.database
        .collection("coaches")
        .orderBy("updatedAt", "desc")
        .limit(100)
        .get(),
    ]);
    const persistedParticipants = participantSnapshot.docs.map((snapshot) =>
      fromSnapshot<MatchParticipant>(snapshot),
    );
    const verified = verifiedSnapshot.exists
      ? fromSnapshot<VerifiedLineupSnapshot>(verifiedSnapshot)
      : undefined;
    if (
      verified &&
      (verified.matchId !== match.id ||
        verified.trackedTeamId !== match.trackedTeamId ||
        verified.externalFixtureId !== match.externalProviderFixtureId)
    ) {
      throw new Error("Verified lineup binding is invalid.");
    }
    const draft = draftSnapshot?.exists
      ? fromSnapshot<AdminLineupDraft>(draftSnapshot)
      : undefined;
    if (
      draft &&
      (draft.ownerId !== ownerId ||
        draft.matchId !== match.id ||
        draft.trackedTeamId !== match.trackedTeamId ||
        draft.externalFixtureId !== match.externalProviderFixtureId)
    ) {
      throw new Error("Saved lineup draft binding is invalid.");
    }
    const participants: AdminParticipantEvidence[] = verified
      ? verified.participants.map((participant) => ({
          playerId: participant.playerId,
          playerName: participant.playerName,
          ...(participant.shirtNumber === undefined
            ? {}
            : { shirtNumber: participant.shirtNumber }),
          ...(participant.position === undefined
            ? {}
            : { position: participant.position }),
          squadRole: participant.squadRole,
          participated: participant.participated,
          participationStatus: participant.participationStatus,
          identityProvenance: participant.identityProvenance,
          participationProvenance: "operator_verified",
          verificationSource: participant.verificationSource,
          ...(participant.enteredAtMinute === undefined
            ? {}
            : { enteredAtMinute: participant.enteredAtMinute }),
        }))
      : persistedParticipants.filter(
          (participant) => participant.teamId === match.trackedTeamId,
        );
    const selectedPlayerIds = [
      ...new Set([
        ...participants.map(({ playerId }) => playerId),
        ...(draft?.participants
          .filter((participant) => !participant.createInternalIdentity)
          .map(({ playerId }) => playerId) ?? []),
      ]),
    ];
    const playerSnapshots =
      selectedPlayerIds.length === 0
        ? []
        : await this.database.getAll(
            ...selectedPlayerIds.map((playerId) =>
              this.database.doc(`players/${playerId}`),
            ),
          );
    const players = new Map<string, Player>();
    for (const snapshot of playerSnapshots) {
      if (snapshot.exists) {
        const player = fromSnapshot<Player>(snapshot);
        players.set(player.id, player);
      }
    }
    const describedMatch = await this.describeMatch(match);
    const metadata = metadataSnapshot.data();
    const reconciliation = reconciliationSnapshot.exists
      ? fromSnapshot<VerifiedLineupReconciliation>(reconciliationSnapshot)
      : undefined;
    if (
      reconciliation &&
      (reconciliation.matchId !== match.id ||
        reconciliation.trackedTeamId !== match.trackedTeamId ||
        reconciliation.externalFixtureId !== match.externalProviderFixtureId)
    ) {
      throw new Error("Lineup reconciliation binding is invalid.");
    }
    return {
      match: {
        ...describedMatch,
        ...(metadata?.lastLifecycleStartedAt instanceof Timestamp
          ? {
              lastLifecycleStartedAt: metadata.lastLifecycleStartedAt
                .toDate()
                .toISOString(),
            }
          : {}),
        ...(metadata?.lastLifecycleCompletedAt instanceof Timestamp
          ? {
              lastLifecycleCompletedAt: metadata.lastLifecycleCompletedAt
                .toDate()
                .toISOString(),
            }
          : {}),
        ...(metadata?.lastLifecycleTrigger === "scheduled" ||
        metadata?.lastLifecycleTrigger === "operator"
          ? { lastLifecycleTrigger: metadata.lastLifecycleTrigger }
          : {}),
        ...(typeof metadata?.lastLifecycleAction === "string"
          ? { lastLifecycleAction: metadata.lastLifecycleAction }
          : {}),
        ...(typeof metadata?.lastLifecycleProviderRequests === "number"
          ? {
              lastLifecycleProviderRequests:
                metadata.lastLifecycleProviderRequests,
            }
          : {}),
      },
      participants: participants.map((participant) => ({
        playerId: participant.playerId,
        playerName: participant.playerName,
        squadRole: participant.squadRole,
        participated: participant.participated,
        ...(participant.participationStatus
          ? { participationStatus: participant.participationStatus }
          : {}),
        ...(participant.shirtNumber === undefined
          ? {}
          : { shirtNumber: participant.shirtNumber }),
        ...(participant.position === undefined
          ? {}
          : { position: participant.position }),
        ...(participant.enteredAtMinute === undefined
          ? {}
          : { enteredAtMinute: participant.enteredAtMinute }),
        ...(participant.identityProvenance
          ? { identityProvenance: participant.identityProvenance }
          : {}),
        ...(participant.participationProvenance
          ? { participationProvenance: participant.participationProvenance }
          : {}),
        ...(participant.verificationSource
          ? { verificationSource: participant.verificationSource }
          : {}),
      })),
      players: [...players.values()]
        .map((player) => ({
          id: player.id,
          name: player.displayName,
          ...(player.position ? { position: player.position } : {}),
          ...(player.photoUrl ? { photoUrl: player.photoUrl } : {}),
          identityProvenance:
            player.identityProvenance ??
            (player.externalProviderId ? "provider" : "operator_verified"),
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "es")),
      coaches: coachesSnapshot.docs.map((snapshot) => {
        const coach = fromSnapshot<Coach>(snapshot);
        return {
          id: coach.id,
          name: coach.displayName,
          provenance: coach.identityProvenance ?? "provider",
          ...(coach.externalProviderId
            ? { externalProviderId: coach.externalProviderId }
            : {}),
        };
      }),
      ...(draft ? { draft } : {}),
      ...(reconciliation ? { reconciliation } : {}),
    };
  }

  async searchPlayers(
    query: string,
    cursor?: string,
  ): Promise<AdminPlayerSearchPage> {
    if (cursor && (cursor.length > 200 || cursor.includes("/"))) {
      throw new Error("Player search cursor is invalid.");
    }
    const page = await searchIndexedTeamPlayers(
      this.database,
      initialClub.teamId,
      query,
      cursor,
      this.observePlayerIndexRead,
    );
    const players = page.players.map(({ player, membership }) => ({
      id: player.id,
      name: player.displayName,
      ...(player.position ? { position: player.position } : {}),
      ...(player.photoUrl ? { photoUrl: player.photoUrl } : {}),
      ...(membership.shirtNumber === undefined
        ? {}
        : { shirtNumber: membership.shirtNumber }),
      identityProvenance:
        player.identityProvenance ??
        (player.externalProviderId ? "provider" : "operator_verified"),
    }));
    return {
      players,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  private async describeMatch(match: Match): Promise<AdminMatchOperation> {
    const participants = this.database.collection(
      `matches/${match.id}/participants`,
    );
    const [assignment, verification, verifiedLineup, participantSnapshot] =
      await Promise.all([
        this.database
          .doc(`matches/${match.id}/coachAssignments/head-coach`)
          .get(),
        this.database
          .doc(`matches/${match.id}/verifiedCoachAssignments/head-coach`)
          .get(),
        this.database.doc(`matches/${match.id}/verifiedLineups/current`).get(),
        participants.get(),
      ]);
    const current = assignment.exists
      ? fromSnapshot<CoachAssignment>(assignment)
      : undefined;
    const verified = verification.exists
      ? fromSnapshot<VerifiedCoachAssignment>(verification)
      : undefined;
    const lineup = verifiedLineup.exists
      ? fromSnapshot<VerifiedLineupSnapshot>(verifiedLineup)
      : undefined;
    const participantValues = participantSnapshot.docs.map((snapshot) =>
      fromSnapshot<MatchParticipant>(snapshot),
    );
    const trackedParticipants = participantValues.filter(
      (participant) => participant.teamId === match.trackedTeamId,
    );
    const confirmedStarterCount = trackedParticipants.filter(
      (participant) =>
        participant.participationStatus === "confirmed_starter" ||
        (participant.starter && participant.participated),
    ).length;
    const confirmedSubstituteCount = trackedParticipants.filter(
      (participant) =>
        participant.participationStatus === "confirmed_substitute",
    ).length;
    return {
      id: match.id,
      externalFixtureId: match.externalProviderFixtureId,
      kickoffAt: match.kickoffAt,
      homeTeamName: match.homeTeam.name,
      awayTeamName: match.awayTeam.name,
      status: match.status,
      ratingState: match.ratingState,
      ...(match.lineupSnapshotAt
        ? { lineupSnapshotAt: match.lineupSnapshotAt }
        : {}),
      ...(match.participantSyncedAt
        ? { participantSyncedAt: match.participantSyncedAt }
        : {}),
      ...(match.finishedObservedAt
        ? { finishedObservedAt: match.finishedObservedAt }
        : {}),
      ...(match.ratingReadyAt ? { ratingReadyAt: match.ratingReadyAt } : {}),
      ...(match.votingOpensAt ? { votingOpensAt: match.votingOpensAt } : {}),
      ...(match.lastProviderSyncAt
        ? { lastProviderSyncAt: match.lastProviderSyncAt }
        : {}),
      ...(match.lastLifecycleRequestedAt
        ? { lastLifecycleRequestedAt: match.lastLifecycleRequestedAt }
        : {}),
      diagnostic: match.ratingBlockReason,
      diagnosticObservedAt: match.ratingBlockObservedAt,
      participantCount: participantValues.length,
      rateableParticipantCount: trackedParticipants.filter(
        (participant) => participant.participated,
      ).length,
      confirmedStarterCount,
      confirmedSubstituteCount,
      unconfirmedOrUnusedCount: Math.max(
        0,
        trackedParticipants.length -
          confirmedStarterCount -
          confirmedSubstituteCount,
      ),
      headCoachReady:
        current !== undefined && current.teamId === match.trackedTeamId,
      lineupProvenance: lineup
        ? "operator_verified"
        : match.lineupSnapshotAt
          ? "provider"
          : "unavailable",
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
      ...(lineup
        ? {
            verifiedLineup: {
              verificationSource: lineup.verificationSource,
              verificationReason: lineup.verificationReason,
              operatorId: lineup.operatorId,
              verifiedAt: lineup.verifiedAt,
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
