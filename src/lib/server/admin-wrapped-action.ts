import {
  wrappedEditionId,
  wrappedSnapshotHash,
} from "@/application/wrapped-snapshot";

export interface AdminWrappedAction {
  wrappedOperation: "approve" | "withdraw";
  trackedTeamId: string;
  tournamentKey: string;
  digest: string;
  epoch: number;
}

export function adminWrappedResourceId(
  action: Pick<AdminWrappedAction, "trackedTeamId" | "tournamentKey">,
) {
  return wrappedEditionId(action.trackedTeamId, action.tournamentKey);
}

export function hashAdminWrappedAction(action: AdminWrappedAction) {
  return wrappedSnapshotHash({
    wrappedOperation: action.wrappedOperation,
    trackedTeamId: action.trackedTeamId,
    tournamentKey: action.tournamentKey,
    digest: action.digest,
    epoch: action.epoch,
  });
}

export function wrappedConfirmation(action: AdminWrappedAction) {
  return [
    action.wrappedOperation,
    action.trackedTeamId,
    action.tournamentKey,
    action.epoch,
    action.digest,
  ].join(":");
}
