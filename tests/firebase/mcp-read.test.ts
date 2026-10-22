import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { coachProviderAliasId } from "@/domain/coach-identity";
import { playerProviderAliasId } from "@/domain/player-identity";
import { playerSearchPrefixes } from "@/domain/player-search";
import { McpOAuthStore, pkceChallenge } from "@/lib/mcp/oauth";
import { McpReadService } from "@/lib/mcp/read-service";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-rating-app-local";
const app = initializeApp({ projectId }, `mcp-read-${Date.now()}`);
const database = getFirestore(app);
const teamId = "mcp-read-team";
const timestamp = Timestamp.fromDate(new Date("2026-10-20T01:00:00.000Z"));

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  await database.doc(`teams/${teamId}`).set({
    displayName: "Equipo MCP",
    shortName: "MCP",
    countryName: "Costa Rica",
    countryCode: "CR",
    brandingKey: "mcp",
    externalProviderId: "815",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc(`teams/${teamId}/playerMembershipIndex/state`).set({
    teamId,
    status: "complete",
    schemaVersion: 1,
    baselineMembershipCount: 1,
    blockingIssueCount: 0,
    auditedAt: timestamp,
  });
  await database.doc("players/mcp-legacy-player").set({
    displayName: "Jugador Anterior",
    externalProvider: "api-football",
    externalProviderId: "44",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc("players/mcp-canonical-player").set({
    displayName: "Jugador Canónico",
    identityProvenance: "operator_verified",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database
    .doc(`playerProviderAliases/${playerProviderAliasId("api-football", "44")}`)
    .set({
      canonicalPlayerId: "mcp-canonical-player",
      canonicalExternalProviderPlayerId: "44",
      externalProvider: "api-football",
      externalProviderPlayerId: "44",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  await database
    .doc(`teams/${teamId}/playerMemberships/mcp-legacy-player`)
    .set({
      teamId,
      displayName: "Jugador Anterior",
      searchName: "jugador anterior",
      searchPrefixes: playerSearchPrefixes("Jugador Anterior"),
      source: "provider_observation",
      firstObservedAt: timestamp,
      lastObservedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  await database.doc("coaches/mcp-provider-coach").set({
    displayName: "Coach API",
    externalProvider: "api-football",
    externalProviderId: "55",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.doc("coaches/mcp-canonical-coach").set({
    displayName: "Coach Canónico",
    identityProvenance: "operator_verified",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database
    .doc(`coachProviderAliases/${coachProviderAliasId("api-football", "55")}`)
    .set({
      canonicalCoachId: "mcp-canonical-coach",
      externalProvider: "api-football",
      externalProviderCoachId: "55",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  await seedMatch(
    "mcp-closed-1",
    "2026-10-20T01:00:00.000Z",
    "rating_closed",
    8,
  );
  await seedMatch(
    "mcp-closed-2",
    "2026-10-19T01:00:00.000Z",
    "rating_closed",
    6,
  );
  await seedMatch(
    "mcp-unpublished",
    "2026-10-21T01:00:00.000Z",
    "rating_ready",
  );
  await seedMatch(
    "mcp-preparing-result",
    "2026-10-18T01:00:00.000Z",
    "rating_closed",
  );
  await database.doc("matches/mcp-closed-1/ballots/private-voter-id").set({
    voterId: "private-voter-id",
    playerRatings: { "mcp-legacy-player": 8 },
  });
});

afterAll(() => deleteApp(app));

describe("read-only MCP data service", () => {
  const service = new McpReadService(database, teamId);

  it("pages matches and only exposes published aggregate results", async () => {
    const first = await service.listMatches({
      kind: "published",
      limit: 1,
      now: new Date("2026-10-22T00:00:00Z"),
    });
    expect(first.matches).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const completedFirst = await service.listMatches({
      kind: "completed",
      limit: 1,
      now: new Date("2026-10-22T00:00:00Z"),
    });
    const completedSecond = await service.listMatches({
      kind: "completed",
      limit: 1,
      cursor: completedFirst.nextCursor,
      now: new Date("2026-10-22T00:00:00Z"),
    });
    expect(completedSecond.matches[0]?.matchId).not.toBe(
      completedFirst.matches[0]?.matchId,
    );
    const result = await service.getMatchResults("mcp-closed-1");
    expect(result).toMatchObject({
      availability: "published",
      result: { ballotCount: 2 },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-voter-id|voterId|playerRatings|ballots/,
    );
    await expect(
      service.getMatchResults("mcp-unpublished"),
    ).resolves.toMatchObject({ availability: "locked" });
    await expect(
      service.getMatchResults("mcp-preparing-result"),
    ).resolves.toMatchObject({ availability: "preparing" });
  });

  it("uses canonical aliases for Player search and published history", async () => {
    await expect(
      service.searchPlayers({ query: "jugador", limit: 5 }),
    ).resolves.toMatchObject({
      players: [
        expect.objectContaining({
          playerId: "mcp-canonical-player",
          name: "Jugador Canónico",
        }),
      ],
    });
    await expect(
      service.getPlayerStatistics({ playerId: "mcp-legacy-player", limit: 1 }),
    ).resolves.toMatchObject({
      availability: "available",
      player: {
        playerId: "mcp-canonical-player",
        ratedMatchCount: 2,
        overallAverage: 7,
      },
      matches: [expect.objectContaining({ average: 8 })],
      nextCursor: expect.any(String),
    });
  });

  it("resolves Coach aliases and states the published-history limitation", async () => {
    await expect(
      service.getCoachStatistics({ coachId: "mcp-provider-coach" }),
    ).resolves.toMatchObject({
      availability: "available",
      coach: {
        coachId: "mcp-canonical-coach",
        name: "Coach Canónico",
        ratedMatchCount: 2,
        overallAverage: 7,
      },
      limitation: expect.stringContaining("resultados publicados"),
    });
  });

  it("does not mutate historical application documents", async () => {
    const references = [
      database.doc("matches/mcp-closed-1"),
      database.doc("matches/mcp-closed-1/results/summary"),
      database.doc("matches/mcp-closed-1/ballots/private-voter-id"),
      database.doc("players/mcp-canonical-player"),
      database.doc("coaches/mcp-canonical-coach"),
      database.doc("teams/mcp-read-team/playerMemberships/mcp-legacy-player"),
    ];
    const before = (await database.getAll(...references)).map((snapshot) =>
      snapshot.data(),
    );
    await service.listMatches({
      kind: "published",
      now: new Date("2026-10-22T00:00:00Z"),
    });
    await service.getMatchResults("mcp-closed-1");
    await service.searchPlayers({ query: "jugador" });
    await service.getPlayerStatistics({ playerId: "mcp-canonical-player" });
    await service.getCoachStatistics({ coachId: "mcp-canonical-coach" });
    expect(
      (await database.getAll(...references)).map((snapshot) => snapshot.data()),
    ).toEqual(before);
  });
});

describe("MCP OAuth persistence", () => {
  it("consumes authorization codes once and revokes opaque access tokens", async () => {
    const store = new McpOAuthStore(database);
    const verifier = "v".repeat(43);
    const code = await store.issueAuthorizationCode({
      ownerId: "owner-uid",
      clientId: "chatgpt",
      redirectUri: "https://chatgpt.com/callback",
      resource: "https://ratings.example/api/mcp",
      scope: "rating:read",
      codeChallenge: pkceChallenge(verifier),
    });
    const tokens = await store.exchangeAuthorizationCode({
      code,
      clientId: "chatgpt",
      redirectUri: "https://chatgpt.com/callback",
      resource: "https://ratings.example/api/mcp",
      codeVerifier: verifier,
    });
    await expect(
      store.verifyAccessToken(tokens.access_token),
    ).resolves.toMatchObject({ scopes: ["rating:read"] });
    await expect(
      store.exchangeAuthorizationCode({
        code,
        clientId: "chatgpt",
        redirectUri: "https://chatgpt.com/callback",
        resource: "https://ratings.example/api/mcp",
        codeVerifier: verifier,
      }),
    ).rejects.toThrow("invalid_grant");
    await store.revoke(tokens.access_token, "chatgpt");
    await expect(
      store.verifyAccessToken(tokens.access_token),
    ).rejects.toMatchObject({ code: "invalid_token" });
    await expect(
      store.refresh(
        tokens.refresh_token,
        "chatgpt",
        "https://ratings.example/api/mcp",
      ),
    ).rejects.toThrow("invalid_grant");
  });
});

async function seedMatch(
  matchId: string,
  kickoffAt: string,
  ratingState: "rating_ready" | "rating_closed",
  average?: number,
) {
  const kickoff = Timestamp.fromDate(new Date(kickoffAt));
  await database.doc(`matches/${matchId}`).set({
    trackedTeamId: teamId,
    trackedTeamExternalProviderId: "815",
    competitionId: "competition",
    seasonId: "season",
    homeTeam: { externalProviderId: "815", name: "Equipo MCP" },
    awayTeam: { externalProviderId: "2", name: `Rival ${matchId}` },
    kickoffAt: kickoff,
    status: "finished",
    ratingState,
    score: { home: 2, away: 1 },
    externalProvider: "api-football",
    externalProviderFixtureId: matchId,
    createdAt: kickoff,
    updatedAt: kickoff,
  });
  if (average === undefined) return;
  await database.doc(`matches/${matchId}/results/summary`).set({
    matchId,
    teamId,
    ballotCount: 2,
    playerResults: {
      "mcp-legacy-player": {
        playerId: "mcp-legacy-player",
        playerName: "Jugador Anterior",
        average,
        voteCount: 2,
        order: 0,
      },
    },
    coachResult: {
      coachId: "mcp-provider-coach",
      coachName: "Coach API",
      average,
      voteCount: 2,
    },
    mvpPlayerIds: ["mcp-legacy-player"],
    status: "final",
    generatedAt: kickoff,
  });
}
