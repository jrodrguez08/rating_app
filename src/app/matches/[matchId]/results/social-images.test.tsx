// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublishedResultPodium } from "@/application/published-result-podium";
import type { Match, MatchResult } from "@/domain/models";

const serviceMocks = vi.hoisted(() => ({
  getPublishedPageState: vi.fn(),
  loadSocialPlayerPhotos: vi.fn(),
}));

vi.mock("@/lib/firebase/server", () => ({
  AdminResultService: class {
    getPublishedPageState = serviceMocks.getPublishedPageState;
  },
}));

vi.mock("@/lib/server/social-player-photo", () => ({
  loadSocialPlayerPhotos: serviceMocks.loadSocialPlayerPhotos,
}));

import {
  OPEN_GRAPH_IMAGE_SIZE,
  STORY_IMAGE_SIZE,
} from "@/components/published-podium-image";

import { GET as getOpenGraphImage } from "./opengraph-image/route";
import { GET as getStoryImage } from "./story/route";

beforeEach(() => {
  serviceMocks.getPublishedPageState.mockReset();
  serviceMocks.loadSocialPlayerPhotos.mockReset();
  serviceMocks.loadSocialPlayerPhotos.mockResolvedValue(new Map());
});

describe("published result social images", () => {
  it("renders the public Open Graph image as a 1200 x 630 PNG", async () => {
    serviceMocks.getPublishedPageState.mockResolvedValue(readyPage);

    const response = await getOpenGraphImage(
      new Request("https://rating-app.test/image"),
      context,
    );

    expect(OPEN_GRAPH_IMAGE_SIZE).toEqual({ width: 1200, height: 630 });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const image = await response.arrayBuffer();
    expect(image.byteLength).toBeGreaterThan(100);
    expect(pngDimensions(image)).toEqual(OPEN_GRAPH_IMAGE_SIZE);
    expect(serviceMocks.loadSocialPlayerPhotos).toHaveBeenCalledWith(
      podium.topThree,
    );
  });

  it("renders a dedicated 1080 x 1920 downloadable Story PNG", async () => {
    serviceMocks.getPublishedPageState.mockResolvedValue(readyPage);

    const response = await getStoryImage(
      new Request("https://rating-app.test/story"),
      context,
    );

    expect(STORY_IMAGE_SIZE).toEqual({ width: 1080, height: 1920 });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toContain(
      "rating-app-match-1-historia.png",
    );
    const image = await response.arrayBuffer();
    expect(image.byteLength).toBeGreaterThan(100);
    expect(pngDimensions(image)).toEqual(STORY_IMAGE_SIZE);
  });

  it.each(["locked", "preparing", "unavailable"] as const)(
    "returns 404 for a %s result without requesting photos",
    async (state) => {
      serviceMocks.getPublishedPageState.mockResolvedValue({ state });

      const [openGraph, story] = await Promise.all([
        getOpenGraphImage(
          new Request("https://rating-app.test/image"),
          context,
        ),
        getStoryImage(new Request("https://rating-app.test/story"), context),
      ]);

      expect(openGraph.status).toBe(404);
      expect(story.status).toBe(404);
      expect(serviceMocks.loadSocialPlayerPhotos).not.toHaveBeenCalled();
    },
  );

  it("returns 404 when a published result has no valid rated podium", async () => {
    serviceMocks.getPublishedPageState.mockResolvedValue({
      ...readyPage,
      podium: null,
    });

    const response = await getOpenGraphImage(
      new Request("https://rating-app.test/image"),
      context,
    );

    expect(response.status).toBe(404);
  });
});

const context = { params: Promise.resolve({ matchId: "match-1" }) };

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

const podium: PublishedResultPodium = {
  matchId: match.id,
  homeTeam: match.homeTeam,
  awayTeam: match.awayTeam,
  score: { home: 2, away: 1 },
  publishedMatchDate: match.kickoffAt,
  generatedAt: "2026-10-20T05:00:00.000Z",
  players: [
    podiumPlayer("p1", "Primer jugador", 9.3, 1, true),
    podiumPlayer("p2", "Segundo jugador", 8.8, 2, false),
    podiumPlayer("p3", "Tercer jugador", 8.4, 3, false),
  ],
  topThree: [],
};
podium.topThree = podium.players.slice(0, 3);

const result: MatchResult = {
  matchId: match.id,
  teamId: match.trackedTeamId,
  ballotCount: 5,
  status: "final",
  playerResults: Object.fromEntries(
    podium.players.map((player, index) => [
      player.playerId,
      {
        playerId: player.playerId,
        playerName: player.displayName,
        average: player.average,
        voteCount: 5,
        order: index,
      },
    ]),
  ),
  coachResult: {
    coachId: "coach-1",
    coachName: "Jafet Soto",
    average: 8,
    voteCount: 5,
  },
  mvpPlayerIds: ["p1"],
  generatedAt: podium.generatedAt,
};

const readyPage = { state: "ready" as const, match, result, podium };

function podiumPlayer(
  playerId: string,
  displayName: string,
  average: number,
  rank: number,
  isMvp: boolean,
) {
  return { playerId, displayName, average, voteCount: 5, rank, isMvp };
}

function pngDimensions(image: ArrayBuffer) {
  const view = new DataView(image);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
