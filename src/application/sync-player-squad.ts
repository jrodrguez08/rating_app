import type { Player } from "@/domain/models";
import type {
  FootballDataProvider,
  FootballSyncStore,
  SyncWriteCounts,
} from "@/domain/ports";

import { providerEntityId } from "./sync-match-participants";

export interface PlayerSquadSyncSummary {
  teamId: string;
  externalTeamId: string;
  squadSize: number;
  players: SyncWriteCounts;
  apiRequests: number;
}

export async function syncPlayerSquad(
  teamId: string,
  provider: FootballDataProvider,
  store: FootballSyncStore,
  now = new Date(),
): Promise<PlayerSquadSyncSummary> {
  const team = await store.getTeam(teamId);
  if (team.externalProviderId === undefined) {
    throw new Error(`Team ${team.id} has no provider mapping.`);
  }
  const squad = await provider.getSquad(team.externalProviderId);
  if (squad.length === 0) {
    throw new Error(
      `Provider returned no usable squad players for Team ${team.externalProviderId}.`,
    );
  }
  const timestamp = now.toISOString();
  const players: Player[] = squad.map((player) => ({
    id: providerEntityId("player", provider.name, player.externalPlayerId),
    displayName: player.name,
    externalProvider: provider.name,
    externalProviderId: player.externalPlayerId,
    ...(player.position === undefined ? {} : { position: player.position }),
    ...(player.photoUrl === undefined ? {} : { photoUrl: player.photoUrl }),
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  return {
    teamId: team.id,
    externalTeamId: team.externalProviderId,
    squadSize: players.length,
    players: await store.upsertPlayers(players),
    apiRequests: provider.requestCount,
  };
}
