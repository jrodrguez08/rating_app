import { describe, expect, it, vi } from "vitest";

import {
  competitionResponse,
  fixtureResponse,
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
      name: "Herediano",
      countryName: "Costa Rica",
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
    const adapter = new ApiFootballAdapter(
      "test-key",
      vi.fn<typeof fetch>().mockResolvedValue(response(fixtureResponse)),
    );

    const fixtures = await adapter.getFixtures("1234", {
      from: "2026-05-01",
      to: "2026-10-01",
    });
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
      adapter.getFixtures("1234", { from: "2026-01-01", to: "2026-12-31" }),
    ).rejects.toMatchObject({ code: "malformed-response" });
  });
});
