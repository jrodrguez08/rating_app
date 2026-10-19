import type { Firestore } from "firebase-admin/firestore";

import type { AdminLineupDraft } from "@/domain/models";
import { AdminLineupError } from "@/lib/server/admin-lineup-error";
import { issueInternalPlayerAllocationToken } from "@/lib/server/admin-player-identity-allocation";

import { AdminLineupDraftService } from "./admin-lineup-draft";
import { getServerFirestore } from "./server";

export interface AdminPlayerIdentityRecoveryInput {
  ownerId: string;
  matchId: string;
  trackedTeamId: string;
  externalFixtureId: string;
}

export interface AdminPlayerIdentityRecoveryResult {
  version: number;
  allocations: Array<{ playerId: string; identityAllocationToken: string }>;
}

export class AdminPlayerIdentityRecoveryService {
  constructor(private readonly database: Firestore = getServerFirestore()) {}

  async recover(
    input: AdminPlayerIdentityRecoveryInput,
  ): Promise<AdminPlayerIdentityRecoveryResult> {
    const draftSnapshot = await this.database
      .doc(`matches/${input.matchId}/lineupDrafts/${input.ownerId}`)
      .get();
    if (!draftSnapshot.exists) {
      throw new AdminLineupError(
        "LINEUP_DRAFT_STALE",
        "A saved lineup draft is required to recover internal identities.",
      );
    }
    const draft = draftSnapshot.data() as AdminLineupDraft;
    if (
      draft.ownerId !== input.ownerId ||
      draft.matchId !== input.matchId ||
      draft.trackedTeamId !== input.trackedTeamId ||
      draft.externalFixtureId !== input.externalFixtureId
    ) {
      throw new AdminLineupError(
        "LINEUP_DRAFT_STALE",
        "Saved lineup draft binding is invalid.",
      );
    }
    const internalParticipants = draft.participants.filter(
      (participant) => participant.createInternalIdentity,
    );
    const existingPlayers = await Promise.all(
      internalParticipants.map((participant) =>
        this.database.doc(`players/${participant.playerId}`).get(),
      ),
    );
    if (existingPlayers.some((snapshot) => snapshot.exists)) {
      throw new AdminLineupError(
        "LINEUP_INTERNAL_IDENTITY_INVALID",
        "An internal identity conflicts with an existing Player.",
      );
    }
    const allocations = internalParticipants.map((participant) => ({
      playerId: participant.playerId,
      identityAllocationToken: issueInternalPlayerAllocationToken({
        playerId: participant.playerId,
        ownerId: input.ownerId,
        matchId: input.matchId,
        trackedTeamId: input.trackedTeamId,
      }),
    }));
    const tokenByPlayer = new Map(
      allocations.map((allocation) => [
        allocation.playerId,
        allocation.identityAllocationToken,
      ]),
    );
    const result = await new AdminLineupDraftService(this.database).save({
      ...input,
      baseVersion: draft.version,
      participants: draft.participants.map((participant) =>
        participant.createInternalIdentity
          ? {
              ...participant,
              identityAllocationToken: tokenByPlayer.get(participant.playerId),
            }
          : participant,
      ),
    });
    return { version: result.version, allocations };
  }
}
