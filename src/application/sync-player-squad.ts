import { proposedPlayerProviderAlias } from "@/config/player-identity-reconciliations";
import type { Player } from "@/domain/models";
import type {
  FootballDataProvider,
  FootballSyncStore,
  SyncWriteCounts,
} from "@/domain/ports";

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
  const aliases = await store.resolvePlayerProviderAliases(
    squad.map((player) =>
      proposedPlayerProviderAlias(
        provider.name,
        player.externalPlayerId,
        timestamp,
      ),
    ),
  );
  const canonicalIds = new Map(
    aliases.map((alias) => [alias.externalProviderPlayerId, alias]),
  );
  const players: Player[] = squad.map((player) => ({
    id: canonicalIds.get(player.externalPlayerId)!.canonicalPlayerId,
    displayName: player.name,
    externalProvider: provider.name,
    externalProviderId: canonicalIds.get(player.externalPlayerId)!
      .canonicalExternalProviderPlayerId,
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
