// @vitest-environment node

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublishedResultPodium } from "@/application/published-result-podium";

const service = vi.hoisted(() => ({ getPublishedPageState: vi.fn() }));
vi.mock("@/lib/firebase/server", () => ({
  AdminResultService: class {
    getPublishedPageState = service.getPublishedPageState;
  },
}));
vi.mock("@/lib/server/social-player-photo", () => ({
  loadSocialPlayerPhotos: async () => new Map(),
}));
// Inspect the actual artwork tree handed to the PNG renderer; existing social
// image tests independently exercise real ImageResponse PNG bytes/dimensions.
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: ReactNode, options?: ResponseInit) {
      super(renderToStaticMarkup(element), options);
    }
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("canonical hostname in generated artwork", () => {
  it.each([undefined, "https://configured.example"])(
    "uses configured/fallback origin %s even on another request host",
    async (configured) => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", configured);
      vi.stubEnv("SAPRISSA_PUBLIC_ENABLED", "true");
      vi.stubEnv("VERCEL_URL", "untrusted-preview.vercel.app");
      vi.resetModules();
      const { GET: story } = await import("./story/route");
      const { GET: table } = await import("./story/table/route");
      for (const [slug, teamId] of [
        ["herediano", "club-sport-herediano"],
        ["saprissa", "deportivo-saprissa"],
      ]) {
        service.getPublishedPageState.mockResolvedValue({
          state: "ready",
          match: { trackedTeamId: teamId },
          podium,
        });
        for (const get of [story, table]) {
          const response = await get(
            new Request(
              "https://untrusted-request.example/image?lang=en&page=1",
              {
                headers: { "X-Forwarded-Host": "untrusted-forwarded.example" },
              },
            ),
            {
              params: Promise.resolve({
                clubSlug: slug,
                matchId: "demo-match",
              }),
            },
          );
          expect(response.status).toBe(200);
          const artwork = await response.text();
          expect(artwork).toContain(
            new URL(configured ?? "https://www.futratecr.com").hostname,
          );
          expect(artwork).not.toContain("untrusted");
          expect(response.headers.get("content-disposition")).toContain(
            `rating-app-${slug}-demo-match-en-`,
          );
        }
      }
    },
  );
});

const player = {
  playerId: "demo-player",
  displayName: "Demo Player",
  average: 9,
  voteCount: 1,
  rank: 1,
  isMvp: true,
};
const podium: PublishedResultPodium = {
  matchId: "demo-match",
  homeTeam: { name: "Demo Home", externalProviderId: "1" },
  awayTeam: { name: "Demo Away", externalProviderId: "2" },
  score: { home: 2, away: 1 },
  publishedMatchDate: "2026-10-20T02:00:00.000Z",
  generatedAt: "2026-10-20T05:00:00.000Z",
  players: [player],
  topThree: [player],
};
