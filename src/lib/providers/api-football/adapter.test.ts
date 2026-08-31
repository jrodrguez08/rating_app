import { describe, expect, it, vi } from "vitest";

import {
  competitionResponse,
  fixtureResponse,
  matchContextResponse,
  teamSearchResponse,
} from "../../../../tests/fixtures/api-football";
import { ApiFootballAdapter, mapApiFootballStatus } from "./adapter";
import { ProviderError } from "./errors";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify({ errors: [], response: body }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiFootballAdapter", () => {
  it("requires a server-side API key", () => {
    expect(() => new ApiFootballAdapter(" ")).toThrowError(
      expect.objectContaining({ code: "missing-api-key" }),
    );
  });

  it("resolves Herediano only when name and country match exactly", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(teamSearchResponse));
    const adapter = new ApiFootballAdapter("test-key", fetcher);

    await expect(
      adapter.resolveTeam({
        displayName: "Club Sport Herediano",
        shortName: "Herediano",
        countryName: "Costa Rica",
      }),
    ).resolves.toEqual({
      externalProviderId: "1234",
      name: "CS Herediano",
      countryName: "Costa-Rica",
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/teams" }),
      expect.objectContaining({ headers: { "x-apisports-key": "test-key" } }),
    );
  });

  it("rejects ambiguous exact Team matches", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response([...teamSearchResponse, ...teamSearchResponse]),
      );
    const adapter = new ApiFootballAdapter("test-key", fetcher);

    await expect(
      adapter.resolveTeam({
        displayName: "Club Sport Herediano",
        shortName: "Herediano",
        countryName: "Costa Rica",
      }),
    ).rejects.toMatchObject({ code: "ambiguous-team" });
  });

  it("parses competition seasons without leaking provider DTOs", async () => {
    const adapter = new ApiFootballAdapter(
      "test-key",
      vi.fn<typeof fetch>().mockResolvedValue(response(competitionResponse)),
    );

    const seasons = await adapter.getCompetitionSeasons("1234");
    expect(seasons).toHaveLength(2);
    expect(seasons[0]).toEqual({
      externalCompetitionId: "71",
      competitionName: "Primera Division",
      countryName: "Costa Rica",
      countryCode: "CR",
      type: "league",
      providerSeason: 2026,
      startsAt: "2026-07-20T00:00:00.000Z",
      endsAt: "2027-05-30T00:00:00.000Z",
      isCurrent: true,
    });
  });

  it("normalizes fixture dates, scores, statuses, and home/away orientation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(fixtureResponse));
    const adapter = new ApiFootballAdapter("test-key", fetcher);

    const fixtures = await adapter.getFixtures(
      "1234",
      { from: "2026-05-01", to: "2026-10-01" },
      [
        {
          externalCompetitionId: "71",
          competitionName: "Primera Division",
          countryName: "Costa Rica",
          type: "league",
          providerSeason: 2026,
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2026-12-31T00:00:00.000Z",
          isCurrent: true,
        },
      ],
    );
    expect(fixtures[0]).toMatchObject({
      externalFixtureId: "5001",
      kickoffAt: "2026-08-20T08:00:00.000Z",
      status: "finished",
      homeTeam: { externalProviderId: "1234", name: "Herediano" },
      awayTeam: { externalProviderId: "2000", name: "Alajuelense" },
      score: { home: 2, away: 1 },
    });
    expect(fixtures[1]).toMatchObject({
      status: "scheduled",
      homeTeam: { externalProviderId: "3000" },
      awayTeam: { externalProviderId: "1234" },
      score: { home: null, away: null },
    });
    const requestedUrl = String(fetcher.mock.calls[0][0]);
    expect(requestedUrl).toContain("season=2026");
  });

  it("refreshes one known fixture without a broad season query", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([fixtureResponse[0]]));
    const adapter = new ApiFootballAdapter("test-key", fetcher);

    const fixture = await adapter.getFixture("5001");

    expect(fixture).toMatchObject({
      externalFixtureId: "5001",
      status: "finished",
      score: { home: 2, away: 1 },
    });
    const requestedUrl = String(fetcher.mock.calls[0][0]);
    expect(requestedUrl).toContain("id=5001");
    expect(requestedUrl).not.toContain("season=");
    expect(adapter.requestCount).toBe(1);
  });

  it("normalizes confirmed goals chronologically and skips malformed goal data", async () => {
    const payload = structuredClone(fixtureResponse);
    payload[0].fixture.status = { short: "2H", elapsed: 90 } as never;
    const fixtureWithEvents = {
      ...payload[0],
      events: [
        {
          time: { elapsed: 90, extra: 4 },
          team: { id: 2000 },
          player: { id: 22, name: "Opponent Scorer" },
          type: "Goal",
          detail: "Penalty",
        },
        {
          time: { elapsed: 23, extra: null },
          team: { id: 1234 },
          player: { id: 11, name: "Tracked Scorer" },
          type: "Goal",
          detail: "Normal Goal",
        },
        {
          time: { elapsed: 30, extra: null },
          team: { id: 1234 },
          player: { id: null, name: null },
          type: "Goal",
          detail: "Normal Goal",
        },
        { type: "Card" },
      ],
    };
    const adapter = new ApiFootballAdapter(
      "test-key",
      vi.fn<typeof fetch>().mockResolvedValue(response([fixtureWithEvents])),
    );

    const fixture = await adapter.getFixture("5001");

    expect(fixture.elapsedMinute).toBe(90);
    expect(fixture.goalEvents).toEqual([
      {
        externalTeamId: "1234",
        externalPlayerId: "11",
        scorerName: "Tracked Scorer",
        elapsed: 23,
        kind: "normal",
      },
      {
        externalTeamId: "2000",
        externalPlayerId: "22",
        scorerName: "Opponent Scorer",
        elapsed: 90,
        extra: 4,
        kind: "penalty",
      },
    ]);
  });

  it("reconciles starters, entering substitutes, unused substitutes, and tracked Team coach", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(matchContextResponse));
    const adapter = new ApiFootballAdapter("test-key", fetcher);

    const context = await adapter.getMatchContext("5001", "1234");

    expect(context.headCoach).toMatchObject({
      externalTeamId: "1234",
      externalCoachId: "900",
      name: "Herediano Coach",
    });
    expect(context.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalTeamId: "1234",
          externalPlayerId: "10",
          squadRole: "starter",
          participated: true,
          position: "G",
          captain: true,
        }),
        expect.objectContaining({
          externalPlayerId: "11",
          participated: true,
          exitedAtMinute: 65,
        }),
        expect.objectContaining({
          externalPlayerId: "20",
          squadRole: "substitute",
          participated: true,
          enteredAtMinute: 65,
        }),
        expect.objectContaining({
          externalPlayerId: "21",
          squadRole: "substitute",
          participated: false,
        }),
      ]),
    );
    expect(context.participants).toHaveLength(4);
    expect(adapter.requestCount).toBe(1);
  });

  it("selects the tracked Team when it is the second lineup and excludes the opponent coach", async () => {
    const adapter = new ApiFootballAdapter(
      "test-key",
      vi.fn<typeof fetch>().mockResolvedValue(response(matchContextResponse)),
    );

    const context = await adapter.getMatchContext("5001", "2000");

    expect(context.headCoach.name).toBe("Opponent Coach");
    expect(context.headCoach.externalTeamId).toBe("2000");
    expect(context.participants).toEqual([
      expect.objectContaining({
        externalPlayerId: "30",
        squadRole: "starter",
        participated: true,
      }),
    ]);
  });

  it("selects the tracked Team by provider ID regardless of lineup ordering", async () => {
    const reordered = structuredClone(matchContextResponse);
    reordered[0].lineups.reverse();
    const adapter = new ApiFootballAdapter(
      "test-key",
      vi.fn<typeof fetch>().mockResolvedValue(response(reordered)),
    );

    const context = await adapter.getMatchContext("5001", "1234");

    expect(context.headCoach.name).toBe("Herediano Coach");
    expect(context.headCoach.externalTeamId).toBe("1234");
    expect(context.participants).toHaveLength(4);
    expect(
      context.participants.every(
        ({ externalTeamId }) => externalTeamId === "1234",
      ),
    ).toBe(true);
  });

  it("fails clearly for incomplete lineups, malformed player IDs, and a missing tracked Team", async () => {
    const noLineup = structuredClone(matchContextResponse);
    noLineup[0].lineups = [];
    await expect(
      new ApiFootballAdapter(
        "test-key",
        vi.fn<typeof fetch>().mockResolvedValue(response(noLineup)),
      ).getMatchContext("5001", "1234"),
    ).rejects.toMatchObject({ code: "lineup-unavailable" });

    const malformedPlayer = structuredClone(matchContextResponse);
    malformedPlayer[0].lineups[0].startXI[0].player.id = null as never;
    await expect(
      new ApiFootballAdapter(
        "test-key",
        vi.fn<typeof fetch>().mockResolvedValue(response(malformedPlayer)),
      ).getMatchContext("5001", "1234"),
    ).rejects.toMatchObject({ code: "malformed-response" });

    await expect(
      new ApiFootballAdapter(
        "test-key",
        vi.fn<typeof fetch>().mockResolvedValue(response(matchContextResponse)),
      ).getMatchContext("5001", "9999"),
    ).rejects.toMatchObject({ code: "tracked-team-missing" });
  });

  it("confirms an entering substitute without inventing a missing minute", async () => {
    const missingMinute = structuredClone(matchContextResponse);
    missingMinute[0].events[0].time.elapsed = null as never;
    missingMinute[0].events = [missingMinute[0].events[0]];
    const adapter = new ApiFootballAdapter(
      "test-key",
      vi.fn<typeof fetch>().mockResolvedValue(response(missingMinute)),
    );

    const context = await adapter.getMatchContext("5001", "1234");
    const substitute = context.participants.find(
      ({ externalPlayerId }) => externalPlayerId === "20",
    );

    expect(substitute).toMatchObject({ participated: true });
    expect(substitute).not.toHaveProperty("enteredAtMinute");
  });

  it.each([
    ["1H", "live"],
    ["PST", "postponed"],
    ["SUSP", "suspended"],
    ["CANC", "cancelled"],
    ["ABD", "abandoned"],
  ])("maps %s to %s", (providerStatus, domainStatus) => {
    expect(mapApiFootballStatus(providerStatus)).toBe(domainStatus);
  });

  it("fails clearly for unknown statuses and malformed fixture dates", async () => {
    expect(() => mapApiFootballStatus("UNKNOWN")).toThrow(ProviderError);
    const malformed = structuredClone(fixtureResponse);
    malformed[0].fixture.date = "not-a-date";
    const adapter = new ApiFootballAdapter(
      "test-key",
      vi.fn<typeof fetch>().mockResolvedValue(response(malformed)),
    );
    await expect(
      adapter.getFixtures("1234", { from: "2026-01-01", to: "2026-12-31" }, [
        {
          externalCompetitionId: "71",
          competitionName: "Primera Division",
          countryName: "Costa Rica",
          type: "league",
          providerSeason: 2026,
          isCurrent: true,
        },
      ]),
    ).rejects.toMatchObject({ code: "malformed-response" });
  });
});
