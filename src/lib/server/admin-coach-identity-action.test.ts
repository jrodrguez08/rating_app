import { describe, expect, it } from "vitest";

import {
  adminCoachIdentityResourceId,
  hashAdminCoachIdentityAction,
  type AdminCoachIdentityAction,
} from "./admin-coach-identity-action";

const action: AdminCoachIdentityAction = {
  trackedTeamId: "club-sport-herediano",
  firstCoachId: "coach-a",
  secondCoachId: "coach-b",
  canonicalCoachId: "coach-a",
  decision: "match",
};

describe("admin Coach identity action", () => {
  it("binds the hash to survivor and decision", () => {
    expect(
      hashAdminCoachIdentityAction({
        ...action,
        trackedTeamId: "deportivo-saprissa",
      }),
    ).not.toBe(hashAdminCoachIdentityAction(action));
    expect(
      hashAdminCoachIdentityAction({ ...action, canonicalCoachId: "coach-b" }),
    ).not.toBe(hashAdminCoachIdentityAction(action));
    expect(
      hashAdminCoachIdentityAction({ ...action, decision: "nonmatch" }),
    ).not.toBe(hashAdminCoachIdentityAction(action));
  });

  it("ignores trusted service context outside the declared action", () => {
    expect(
      hashAdminCoachIdentityAction({
        ...action,
        operatorId: "owner-one",
      } as AdminCoachIdentityAction),
    ).toBe(hashAdminCoachIdentityAction(action));
  });

  it("uses an order-independent pair resource", () => {
    expect(adminCoachIdentityResourceId(action)).toBe(
      "club-sport-herediano:coach-a:coach-b",
    );
    expect(
      adminCoachIdentityResourceId({
        ...action,
        firstCoachId: "coach-b",
        secondCoachId: "coach-a",
      }),
    ).toBe("club-sport-herediano:coach-a:coach-b");
  });
});
