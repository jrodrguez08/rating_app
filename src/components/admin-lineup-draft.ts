import type { ParticipationStatus, PlayerPosition } from "@/domain/models";
import type {
  AdminMatchDetail,
  AdminPlayerOption,
} from "@/lib/firebase/admin-console";
import type { AdminLineupParticipantAction } from "@/lib/server/admin-lineup-action";

export type LineupLane = "starters" | "available" | "entered" | "unconfirmed";

export interface EditableParticipant extends AdminLineupParticipantAction {
  playerName: string;
  evidenceProvenance: "provider" | "operator_verified";
}

export interface LineupChange {
  playerId: string;
  playerName: string;
  before?: ParticipationStatus;
  after?: ParticipationStatus;
}

export function buildInitialParticipants(
  detail: AdminMatchDetail,
): EditableParticipant[] {
  return detail.participants.map((participant) => ({
    playerId: participant.playerId,
    playerName: participant.playerName,
    createInternalIdentity:
      participant.identityProvenance === "operator_verified" &&
      !detail.players.some((player) => player.id === participant.playerId),
    evidenceProvenance:
      participant.participationProvenance ??
      (detail.match.verifiedLineup ? "operator_verified" : "provider"),
    squadRole: participant.squadRole,
    participationStatus:
      participant.participationStatus ??
      (participant.squadRole === "starter"
        ? "confirmed_starter"
        : participant.participated
          ? "confirmed_substitute"
          : "unused_substitute"),
    ...(participant.shirtNumber === undefined
      ? {}
      : { shirtNumber: participant.shirtNumber }),
    ...(isPlayerPosition(participant.position)
      ? { position: participant.position }
      : {}),
    ...(participant.enteredAtMinute === undefined
      ? {}
      : { enteredAtMinute: participant.enteredAtMinute }),
  }));
}

export function participantForLane(
  participant: Pick<
    EditableParticipant,
    "playerId" | "playerName" | "createInternalIdentity" | "evidenceProvenance"
  > &
    Partial<EditableParticipant>,
  lane: LineupLane,
): EditableParticipant {
  const starter = lane === "starters";
  const participationStatus: ParticipationStatus = starter
    ? "confirmed_starter"
    : lane === "entered"
      ? "confirmed_substitute"
      : lane === "unconfirmed"
        ? "unconfirmed"
        : "unused_substitute";
  return {
    ...participant,
    playerId: participant.playerId,
    playerName: participant.playerName,
    createInternalIdentity: participant.createInternalIdentity,
    evidenceProvenance: participant.evidenceProvenance,
    squadRole: starter ? "starter" : "substitute",
    participationStatus,
    ...(participationStatus === "confirmed_substitute"
      ? {}
      : { enteredAtMinute: undefined }),
  };
}

export function laneFor(participant: EditableParticipant): LineupLane {
  if (participant.squadRole === "starter") return "starters";
  if (participant.participationStatus === "confirmed_substitute")
    return "entered";
  if (participant.participationStatus === "unconfirmed") return "unconfirmed";
  return "available";
}

export function isLane(value: string | number): value is LineupLane {
  return ["starters", "available", "entered", "unconfirmed"].includes(
    String(value),
  );
}

export function countLane(
  participants: EditableParticipant[],
  lane: LineupLane,
): number {
  return participants.filter((participant) => laneFor(participant) === lane)
    .length;
}

export function describeChanges(
  initial: EditableParticipant[],
  proposed: EditableParticipant[],
): LineupChange[] {
  const before = new Map(
    initial.map((participant) => [participant.playerId, participant]),
  );
  const after = new Map(
    proposed.map((participant) => [participant.playerId, participant]),
  );
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids]
    .map((playerId): LineupChange | null => {
      const current = before.get(playerId);
      const next = after.get(playerId);
      if (
        current?.participationStatus === next?.participationStatus &&
        current?.enteredAtMinute === next?.enteredAtMinute
      ) {
        return null;
      }
      return {
        playerId,
        playerName: next?.playerName ?? current?.playerName ?? playerId,
        ...(current ? { before: current.participationStatus } : {}),
        ...(next ? { after: next.participationStatus } : {}),
      };
    })
    .filter((change): change is LineupChange => change !== null);
}

export function mergePlayers(
  current: AdminPlayerOption[],
  incoming: AdminPlayerOption[],
): AdminPlayerOption[] {
  const players = new Map(current.map((player) => [player.id, player]));
  for (const player of incoming) players.set(player.id, player);
  return [...players.values()];
}

export function isPlayerSearchResponse(
  value: unknown,
): value is { players: AdminPlayerOption[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "players" in value &&
    Array.isArray(value.players) &&
    value.players.every(
      (player) =>
        typeof player === "object" &&
        player !== null &&
        "id" in player &&
        typeof player.id === "string" &&
        "name" in player &&
        typeof player.name === "string" &&
        "identityProvenance" in player &&
        ["provider", "operator_verified"].includes(
          String(player.identityProvenance),
        ),
    )
  );
}

function isPlayerPosition(value: string | undefined): value is PlayerPosition {
  return ["goalkeeper", "defender", "midfielder", "attacker"].includes(
    value ?? "",
  );
}
