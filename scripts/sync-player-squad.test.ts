import { describe, expect, it } from "vitest";

import { parsePlayerSquadSyncArguments } from "./sync-player-squad";

describe("player squad sync arguments", () => {
  it("requires an exact project and confirmation phrase", () => {
    expect(
      parsePlayerSquadSyncArguments([
        "--project-id",
        "rating-app-prod-8b7df",
        "--confirm",
        "sync-player-squad",
      ]),
    ).toEqual({ projectId: "rating-app-prod-8b7df" });
  });

  it.each([
    { arguments_: [] },
    { arguments_: ["--project-id", "project"] },
    { arguments_: ["--project-id", "project", "--confirm", "wrong"] },
    {
      arguments_: [
        "--project-id",
        "a",
        "--project-id",
        "b",
        "--confirm",
        "sync-player-squad",
      ],
    },
  ])("rejects unsafe arguments", ({ arguments_ }) => {
    expect(() => parsePlayerSquadSyncArguments(arguments_)).toThrow(/Usage:/);
  });
});
