import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  home: vi.fn(),
  matches: vi.fn(),
  match: vi.fn(),
  players: vi.fn(),
  profile: vi.fn(),
  standings: vi.fn(),
  studio: vi.fn(),
  ballot: vi.fn(),
  result: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/firebase/lifecycle-read", () => ({
  getPublicHomeMatch: reads.home,
}));
vi.mock("@/lib/firebase/server", () => ({
  AdminMatchArchiveService: class {
    list = reads.matches;
    get = reads.match;
  },
  AdminPlayerHistoryService: class {
    list = reads.players;
    get = reads.profile;
  },
  AdminStandingsService: class {
    get = reads.standings;
  },
  AdminStudioService: class {
    listPublishedMatches = reads.studio;
  },
  AdminBallotService: class {
    getPageState = reads.ballot;
  },
  AdminResultService: class {
    getPublishedPageState = reads.result;
  },
}));

import Home from "./page";
import MatchesPage from "./matches/page";
import MatchDetailPage from "./matches/[matchId]/page";
import RateMatchPage from "./matches/[matchId]/rate/page";
import MatchResultsPage from "./matches/[matchId]/results/page";
import PlayersPage from "./players/page";
import PlayerProfilePage from "./players/[playerId]/page";
import StandingsPage from "./standings/page";
import StudioPage from "./studio/page";

beforeEach(() => {
  Object.values(reads).forEach((read) => read.mockReset());
  reads.home.mockResolvedValue(null);
  reads.matches.mockResolvedValue(null);
});

describe("club route server boundary", () => {
  it("keeps Saprissa home provider-free and free of Herediano data", async () => {
    render(
      await Home({
        params: Promise.resolve({ clubSlug: "saprissa" }),
      } as never),
    );
    expect(
      screen.getByRole("heading", { name: "Deportivo Saprissa" }),
    ).toBeInTheDocument();
    expect(reads.home).not.toHaveBeenCalled();
    expect(reads.matches).not.toHaveBeenCalled();
  });

  it("rejects unknown clubs and all unfinished Saprissa data routes before reads", async () => {
    const pages = [
      () =>
        MatchesPage({
          params: Promise.resolve({ clubSlug: "saprissa" }),
        } as never),
      () =>
        MatchDetailPage({
          params: Promise.resolve({
            clubSlug: "saprissa",
            matchId: "herediano-match",
          }),
        }),
      () =>
        RateMatchPage({
          params: Promise.resolve({
            clubSlug: "saprissa",
            matchId: "herediano-match",
          }),
        }),
      () =>
        MatchResultsPage({
          params: Promise.resolve({
            clubSlug: "saprissa",
            matchId: "herediano-match",
          }),
        }),
      () =>
        PlayersPage({
          params: Promise.resolve({ clubSlug: "saprissa" }),
        } as never),
      () =>
        PlayerProfilePage({
          params: Promise.resolve({
            clubSlug: "saprissa",
            playerId: "herediano-player",
          }),
        }),
      () =>
        StandingsPage({
          params: Promise.resolve({ clubSlug: "saprissa" }),
        } as never),
      () =>
        StudioPage({
          params: Promise.resolve({ clubSlug: "saprissa" }),
          searchParams: Promise.resolve({}),
        }),
      () =>
        MatchesPage({
          params: Promise.resolve({ clubSlug: "matches" }),
        } as never),
    ];
    for (const page of pages) {
      await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    Object.values(reads).forEach((read) => expect(read).not.toHaveBeenCalled());
  });

  it("uses the persisted Herediano Team ID on the operational public routes", async () => {
    await Home({ params: Promise.resolve({ clubSlug: "herediano" }) } as never);
    await MatchesPage({
      params: Promise.resolve({ clubSlug: "herediano" }),
    } as never);
    expect(reads.home).toHaveBeenCalledWith("club-sport-herediano");
    expect(reads.matches).toHaveBeenCalledWith("club-sport-herediano");
  });
});
