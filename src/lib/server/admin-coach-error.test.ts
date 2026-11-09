import { describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import {
  AdminVerifiedCoachAssignmentRejectedError,
  coachErrorKeys,
} from "./admin-coach-error";
import { hashAdminCoachAction } from "./admin-coach-action";
import { adminCoachError, parseAdminCoachAction } from "./admin-request";

describe("Coach assignment safe error contract", () => {
  it("reports each known failure with a stable code and translated safe wording", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const code of Object.keys(
        coachErrorKeys,
      ) as (keyof typeof coachErrorKeys)[]) {
        if (code === "COACH_OPERATION_UNAVAILABLE") continue;
        const response = adminCoachError(
          new AdminVerifiedCoachAssignmentRejectedError(
            "private evidence and tokens",
            code,
          ),
          "apply",
        );
        const body = await response.json();
        expect(body.code).toBe(code);
        expect(body.error).toBe(
          getMessages("es").admin.coachErrors[coachErrorKeys[code]],
        );
        expect(
          getMessages("en").admin.coachErrors[coachErrorKeys[code]],
        ).toBeTruthy();
        expect(JSON.stringify(body)).not.toContain("private evidence");
      }
      expect(JSON.stringify(log.mock.calls)).not.toContain("private evidence");
    } finally {
      log.mockRestore();
    }
  });
  it("returns 500 and a correlation ID for unexpected failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = adminCoachError(new Error("private secret"), "preview");
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.code).toBe("COACH_OPERATION_UNAVAILABLE");
      expect(body.error).toContain(body.requestId);
      expect(response.headers.get("X-Request-ID")).toBe(body.requestId);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private secret");
    } finally {
      log.mockRestore();
    }
  });
  it("preserves and binds the preview identity version in parsed actions", () => {
    const action = {
      matchId: "match",
      trackedTeamId: "team",
      externalFixtureId: "fixture",
      coachId: "coach",
      coachName: "Coach",
      externalProviderCoachId: "42",
      verificationSource: "authenticated-owner",
      verificationReason: "Independent evidence.",
      coachIdentityVersion: "a".repeat(64),
    };
    expect(parseAdminCoachAction(action)).toEqual(action);
    expect(hashAdminCoachAction(action)).not.toBe(
      hashAdminCoachAction({ ...action, coachIdentityVersion: "b".repeat(64) }),
    );
    expect(() =>
      parseAdminCoachAction({ ...action, coachIdentityVersion: "invalid" }),
    ).toThrow();
    expect(
      parseAdminCoachAction({ ...action, externalProviderCoachId: "" })
        .externalProviderCoachId,
    ).toBe("");
  });
});
