import { Timestamp, type Firestore } from "firebase-admin/firestore";

import type {
  AdminLineupDraft,
  AdminLineupDraftParticipant,
  Match,
  MatchParticipant,
  Player,
  TeamPlayerMembership,
} from "@/domain/models";
import {
  hashAdminLineupDraft,
  type AdminLineupDraftAction,
} from "@/lib/server/admin-lineup-draft-action";

import { getServerFirestore } from "./server";

const MAX_DRAFT_PARTICIPANTS = 30;

export interface AdminLineupDraftInput extends AdminLineupDraftAction {
  ownerId: string;
}

export interface AdminLineupDraftResult {
  version: number;
  updatedAt: string;
  disposition: "committed" | "idempotent_retry";
}

export class AdminLineupDraftService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async save(input: AdminLineupDraftInput): Promise<AdminLineupDraftResult> {
    validateDraftInput(input);
    const contentHash = hashAdminLineupDraft(input);
    return this.database.runTransaction(async (transaction) => {
      const matchReference = this.database.doc(`matches/${input.matchId}`);
      const draftReference = this.database.doc(
        `matches/${input.matchId}/lineupDrafts/${input.ownerId}`,
      );
      const resultReference = this.database.doc(
        `matches/${input.matchId}/results/summary`,
      );
      const ballotsQuery = this.database
        .collection(`matches/${input.matchId}/ballots`)
        .limit(1);
      const revisionsQuery = this.database
        .collection(`matches/${input.matchId}/resultRevisions`)
        .limit(1);
      const [matchSnapshot, draftSnapshot, resultSnapshot, ballots, revisions] =
        await Promise.all([
          transaction.get(matchReference),
          transaction.get(draftReference),
          transaction.get(resultReference),
          transaction.get(ballotsQuery),
          transaction.get(revisionsQuery),
        ]);
      if (!matchSnapshot.exists) throw new Error("Match was not found.");
      const match = fromSnapshot<Match>(matchSnapshot);
      if (
        match.trackedTeamId !== input.trackedTeamId ||
        match.externalProviderFixtureId !== input.externalFixtureId
      ) {
        throw new Error("The Team or fixture binding is invalid.");
      }
      const existing = draftSnapshot.exists
        ? fromSnapshot<AdminLineupDraft>(draftSnapshot)
        : undefined;
      if (
        existing &&
        (existing.ownerId !== input.ownerId ||
          existing.matchId !== input.matchId ||
          existing.trackedTeamId !== input.trackedTeamId ||
          existing.externalFixtureId !== input.externalFixtureId)
      ) {
        throw new Error("The saved lineup draft binding is invalid.");
      }
      const currentVersion = existing?.version ?? 0;
      if (currentVersion !== input.baseVersion) {
        if (
          currentVersion === input.baseVersion + 1 &&
          existing?.contentHash === contentHash
        ) {
          return {
            version: currentVersion,
            updatedAt: existing.updatedAt,
            disposition: "idempotent_retry" as const,
          };
        }
        throw new Error("Stale lineup draft version.");
      }
      if (
        !["scheduled", "live", "finished"].includes(match.status) ||
        !["not_ready", "preparing_rating"].includes(match.ratingState) ||
        resultSnapshot.exists ||
        !ballots.empty ||
        !revisions.empty
      ) {
        throw new Error("Lineup draft is not permitted for this match state.");
      }

      const canonicalParticipants = input.participants.filter(
        (participant) => !participant.createInternalIdentity,
      );
      const playerReferences = canonicalParticipants.map((participant) =>
        this.database.doc(`players/${participant.playerId}`),
      );
      const membershipReferences = canonicalParticipants.map((participant) =>
        this.database.doc(
          `teams/${input.trackedTeamId}/playerMemberships/${participant.playerId}`,
        ),
      );
      const participantReferences = canonicalParticipants.map((participant) =>
        this.database.doc(
          `matches/${input.matchId}/participants/${participant.playerId}`,
        ),
      );
      const [playerSnapshots, membershipSnapshots, participantSnapshots] =
        canonicalParticipants.length === 0
          ? [[], [], []]
          : await Promise.all([
              transaction.getAll(...playerReferences),
              transaction.getAll(...membershipReferences),
              transaction.getAll(...participantReferences),
            ]);
      const priorIds = new Set(
        existing?.participants.map((participant) => participant.playerId) ?? [],
      );
      const canonicalById = new Map<string, Player>();
      canonicalParticipants.forEach((participant, index) => {
        const playerSnapshot = playerSnapshots[index];
        if (!playerSnapshot.exists) {
          throw new Error("Canonical player identity was not found.");
        }
        const player = fromSnapshot<Player>(playerSnapshot);
        const membership = membershipSnapshots[index].exists
          ? fromSnapshot<TeamPlayerMembership>(membershipSnapshots[index])
          : undefined;
        const matchParticipant = participantSnapshots[index].exists
          ? fromSnapshot<MatchParticipant>(participantSnapshots[index])
          : undefined;
        const belongsToTeam =
          player.currentTeamId === input.trackedTeamId ||
          (membership?.teamId === input.trackedTeamId &&
            membership.playerId === player.id) ||
          matchParticipant?.teamId === input.trackedTeamId ||
          priorIds.has(player.id);
        if (!belongsToTeam) {
          throw new Error(
            "Canonical player does not belong to the tracked Team.",
          );
        }
        canonicalById.set(player.id, player);
      });

      const participants = input.participants.map(
        (participant): AdminLineupDraftParticipant => {
          if (participant.createInternalIdentity) return participant;
          const player = canonicalById.get(participant.playerId)!;
          return {
            ...participant,
            playerName: player.displayName,
            ...((participant.position ?? player.position)
              ? { position: participant.position ?? player.position }
              : {}),
          };
        },
      );
      const timestamp = matchSnapshot.readTime.toDate().toISOString();
      const version = currentVersion + 1;
      const draft: AdminLineupDraft = {
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
        externalFixtureId: input.externalFixtureId,
        ownerId: input.ownerId,
        version,
        contentHash,
        participants,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      transaction.set(draftReference, toDocument(draft));
      return {
        version,
        updatedAt: timestamp,
        disposition: "committed" as const,
      };
    });
  }
}

function validateDraftInput(input: AdminLineupDraftInput): void {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.matchId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.trackedTeamId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.externalFixtureId) ||
    !/^[A-Za-z0-9_.@:-]{1,128}$/.test(input.ownerId) ||
    !Number.isInteger(input.baseVersion) ||
    input.baseVersion < 0 ||
    input.participants.length > MAX_DRAFT_PARTICIPANTS
  ) {
    throw new Error("Lineup draft input is invalid.");
  }
  const ids = new Set<string>();
  let starters = 0;
  for (const participant of input.participants) {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(participant.playerId) ||
      ids.has(participant.playerId) ||
      participant.playerName.trim().length < 2 ||
      participant.playerName.length > 120 ||
      !validRoleStatus(participant) ||
      (participant.shirtNumber !== undefined &&
        (!Number.isInteger(participant.shirtNumber) ||
          participant.shirtNumber < 1 ||
          participant.shirtNumber > 99)) ||
      (participant.enteredAtMinute !== undefined &&
        (!Number.isInteger(participant.enteredAtMinute) ||
          participant.enteredAtMinute < 1 ||
          participant.enteredAtMinute > 130))
    ) {
      throw new Error("Lineup draft input is invalid.");
    }
    ids.add(participant.playerId);
    if (participant.squadRole === "starter") starters += 1;
  }
  if (starters > 11) throw new Error("Lineup draft input is invalid.");
}

function validRoleStatus(participant: AdminLineupDraftParticipant): boolean {
  if (participant.squadRole === "starter") {
    return (
      participant.participationStatus === "confirmed_starter" &&
      participant.enteredAtMinute === undefined
    );
  }
  if (participant.participationStatus === "confirmed_starter") return false;
  return (
    participant.participationStatus === "confirmed_substitute" ||
    participant.enteredAtMinute === undefined
  );
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

function toDocument<T>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [
        key,
        key.endsWith("At") && typeof item === "string"
          ? Timestamp.fromDate(new Date(item))
          : item,
      ]),
  );
}
