import { describe, expect, it } from "vitest";

import type { Match, MatchResult, Player } from "@/domain/models";

import { buildPublishedResultPodium } from "./published-result-podium";

describe("published result podium", () => {
  it("keeps published ranking tie breakers, canonical identities, photos, and MVP semantics", () => {
    const presentation = buildPublishedResultPodium({
      match,
      result,
      canonicalPlayerIds: new Map([["legacy", "canonical"]]),
      identities: [
        player("legacy", "Nombre anterior", "11"),
        player(
          "canonical",
          "Nombre canónico muy largo para probar el diseño",
          "22",
        ),
        player("second", "Segundo", "33"),
        player("third", "Tercero"),
        player("fourth", "Cuarto"),
      ],
    });

    expect(presentation?.players.map(({ playerId }) => playerId)).toEqual([
      "canonical",
      "second",
      "third",
      "fourth",
    ]);
    expect(presentation?.topThree).toHaveLength(3);
    expect(presentation?.topThree[0]).toMatchObject({
      playerId: "canonical",
      displayName: "Nombre canónico muy largo para probar el diseño",
      average: 9,
      rank: 1,
      isMvp: true,
      photoUrl: "https://media.api-sports.io/football/players/22.png",
    });
    expect(presentation?.topThree[1]).toMatchObject({
      playerId: "second",
      average: 9,
      rank: 2,
      isMvp: true,
    });
  });

  it("shows only the available rated players and accepts missing photos", () => {
    const presentation = buildPublishedResultPodium({
      match,
      result: {
        ...result,
        playerResults: { third: result.playerResults.third },
        mvpPlayerIds: ["third"],
      },
      identities: [player("third", "Tercero")],
    });

    expect(presentation?.topThree).toEqual([
      expect.objectContaining({
        playerId: "third",
        average: 8,
        rank: 1,
        isMvp: true,
      }),
    ]);
    expect(presentation?.topThree[0]).not.toHaveProperty("photoUrl");
  });

  it.each([
    ["no votes", { ...result, status: "no_votes" as const, ballotCount: 0 }],
    ["reopened", result],
  ])("does not publish a podium for %s", (_label, candidate) => {
    expect(
      buildPublishedResultPodium({
        match:
          _label === "reopened"
            ? { ...match, ratingState: "rating_ready" }
            : match,
        result: candidate,
        identities: [],
      }),
    ).toBeNull();
  });

  it("rejects conflicting published values that resolve to one canonical Player", () => {
    expect(
      buildPublishedResultPodium({
        match,
        result: {
          ...result,
          playerResults: {
            legacy: result.playerResults.legacy,
            canonical: {
              ...result.playerResults.legacy,
              playerId: "canonical",
              average: 8.5,
            },
          },
          mvpPlayerIds: ["legacy"],
        },
        identities: [],
        canonicalPlayerIds: new Map([["legacy", "canonical"]]),
      }),
    ).toBeNull();
  });
});

const match: Match = {
  id: "match-1",
  trackedTeamId: "team-1",
  competitionId: "competition-1",
  seasonId: "season-1",
  homeTeam: { externalProviderId: "815", name: "Herediano" },
  awayTeam: { externalProviderId: "819", name: "Pérez Zeledón" },
  kickoffAt: "2026-10-20T02:00:00.000Z",
  status: "finished",
  ratingState: "rating_closed",
  score: { home: 2, away: 1 },
  externalProvider: "api-football",
  externalProviderFixtureId: "1551706",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T05:00:00.000Z",
};

const result: MatchResult = {
  matchId: match.id,
  teamId: match.trackedTeamId,
  ballotCount: 4,
  status: "final",
  playerResults: {
    legacy: resultPlayer("legacy", "Nombre anterior", 9, 0),
    second: resultPlayer("second", "Segundo", 9, 1),
    third: resultPlayer("third", "Tercero", 8, 2),
    fourth: resultPlayer("fourth", "Cuarto", 7.5, 3),
  },
  coachResult: {
    coachId: "coach-1",
    coachName: "Jafet Soto",
    average: 8,
    voteCount: 4,
  },
  mvpPlayerIds: ["legacy", "second"],
  generatedAt: "2026-10-20T05:00:00.000Z",
};

function resultPlayer(
  playerId: string,
  playerName: string,
  average: number,
  order: number,
) {
  return { playerId, playerName, average, voteCount: 4, order };
}

function player(id: string, displayName: string, photoId?: string): Player {
  return {
    id,
    displayName,
    ...(photoId === undefined
      ? {}
      : {
          photoUrl: `https://media.api-sports.io/football/players/${photoId}.png`,
        }),
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}
