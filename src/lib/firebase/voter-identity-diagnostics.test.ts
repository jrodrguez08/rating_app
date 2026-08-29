import { FirebaseError } from "firebase/app";
import { describe, expect, it, vi } from "vitest";

import { reportVoterIdentityFailure } from "./voter-identity-diagnostics";
import { VoterIdentityError } from "./voter-auth";

describe("reportVoterIdentityFailure", () => {
  it.each(["local", "development"] as const)(
    "logs a safe mapped category and Firebase code in %s",
    (environment) => {
      const logger = vi.fn();
      reportVoterIdentityFailure(
        new VoterIdentityError("unavailable", {
          cause: new FirebaseError(
            "auth/network-request-failed",
            "sensitive network detail",
          ),
        }),
        { environment, nodeEnvironment: "development", logger },
      );

      expect(logger).toHaveBeenCalledWith(
        "Unable to prepare the voter session.",
        {
          code: "unavailable",
          causeCode: "auth/network-request-failed",
        },
      );
      expect(JSON.stringify(logger.mock.calls)).not.toContain("sensitive");
    },
  );

  it("keeps production diagnostics generic", () => {
    const logger = vi.fn();
    reportVoterIdentityFailure(
      new VoterIdentityError("disabled", {
        cause: new Error("private configuration detail"),
      }),
      { environment: "production", nodeEnvironment: "production", logger },
    );

    expect(logger).toHaveBeenCalledWith("Unable to prepare the voter session.");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("private");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("disabled");
  });

  it("does not copy arbitrary cause codes into diagnostics", () => {
    const logger = vi.fn();
    reportVoterIdentityFailure(
      new VoterIdentityError("configuration", {
        cause: { code: "secret/private-key", token: "do-not-log" },
      }),
      { environment: "local", nodeEnvironment: "development", logger },
    );

    expect(logger).toHaveBeenCalledWith(
      "Unable to prepare the voter session.",
      { code: "configuration" },
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain("do-not-log");
  });
});
