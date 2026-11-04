import { describe, expect, it } from "vitest";

import {
  isScheduledClubEnabled,
  publicClub,
  scheduledClubFromRequest,
} from "./club-operations";

describe("club operation and public exposure controls", () => {
  it("preserves Herediano and keeps Saprissa private and unscheduled by default", () => {
    expect(isScheduledClubEnabled("herediano", {})).toBe(true);
    expect(isScheduledClubEnabled("saprissa", {})).toBe(false);
    expect(publicClub("herediano", {}).publicAvailability).toBe("active");
    expect(publicClub("saprissa", {}).publicAvailability).toBe("coming_soon");
  });

  it("requires exact independent flags and fails malformed values closed", () => {
    expect(
      isScheduledClubEnabled("saprissa", { SAPRISSA_PUBLIC_ENABLED: "true" }),
    ).toBe(false);
    expect(
      publicClub("saprissa", { SAPRISSA_SCHEDULED_ENABLED: "true" })
        .publicAvailability,
    ).toBe("coming_soon");
    expect(
      isScheduledClubEnabled("saprissa", {
        SAPRISSA_SCHEDULED_ENABLED: "TRUE",
      }),
    ).toBe(false);
    expect(
      publicClub("saprissa", { SAPRISSA_PUBLIC_ENABLED: "yes" })
        .publicAvailability,
    ).toBe("coming_soon");
    expect(
      publicClub("saprissa", { SAPRISSA_PUBLIC_ENABLED: "true" })
        .publicAvailability,
    ).toBe("active");
  });

  it("rejects ambiguous and unknown scheduled targets", () => {
    expect(
      scheduledClubFromRequest(new Request("https://example.test"), {}),
    ).toMatchObject({ status: "enabled", club: { slug: "herediano" } });
    expect(
      scheduledClubFromRequest(
        new Request("https://example.test?club=saprissa"),
        {},
      ).status,
    ).toBe("disabled");
    expect(
      scheduledClubFromRequest(
        new Request("https://example.test?club=saprissa"),
        { SAPRISSA_SCHEDULED_ENABLED: "true" },
      ),
    ).toMatchObject({
      status: "enabled",
      club: { teamId: "deportivo-saprissa" },
    });
    for (const query of [
      "club=unknown",
      "club=saprissa&club=herediano",
      "other=value",
    ]) {
      expect(
        scheduledClubFromRequest(
          new Request(`https://example.test?${query}`),
          {},
        ).status,
      ).toBe("invalid");
    }
  });
});
