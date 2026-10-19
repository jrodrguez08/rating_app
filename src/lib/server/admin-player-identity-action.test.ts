import { describe, expect, it } from "vitest";

import {
  adminPlayerIdentityResourceId,
  hashAdminPlayerIdentityAction,
  playerIdentityReviewId,
  type AdminPlayerIdentityAction,
} from "./admin-player-identity-action";

const action: AdminPlayerIdentityAction = {
  firstPlayerId: "player-one",
  secondPlayerId: "player-two",
  canonicalPlayerId: "player-one",
  trackedTeamId: "club-sport-herediano",
  decision: "match",
};

describe("admin Player identity action", () => {
  it("uses an order-independent pair resource and review identity", () => {
    const reversed = {
      ...action,
      firstPlayerId: action.secondPlayerId,
      secondPlayerId: action.firstPlayerId,
    };

    expect(adminPlayerIdentityResourceId(reversed)).toBe(
      adminPlayerIdentityResourceId(action),
    );
    expect(
      playerIdentityReviewId(reversed.firstPlayerId, reversed.secondPlayerId),
    ).toBe(playerIdentityReviewId(action.firstPlayerId, action.secondPlayerId));
  });

  it("binds authorization to the selected survivor and decision", () => {
    expect(
      hashAdminPlayerIdentityAction({
        ...action,
        canonicalPlayerId: action.secondPlayerId,
      }),
    ).not.toBe(hashAdminPlayerIdentityAction(action));
    expect(
      hashAdminPlayerIdentityAction({ ...action, decision: "nonmatch" }),
    ).not.toBe(hashAdminPlayerIdentityAction(action));
  });
});
