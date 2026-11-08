// @vitest-environment node

/* eslint-disable @next/next/no-img-element -- Exercise the production ImageResponse renderer. */
import { mkdir, writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import type { PublishedResultPodium } from "@/application/published-result-podium";
import { clubs } from "@/config/club";
import { esMessages } from "@/i18n/messages/es";
import { loadSocialPlayerPhoto } from "@/lib/server/social-player-photo";

import {
  PublishedPodiumImage,
  OPEN_GRAPH_IMAGE_SIZE,
  STORY_IMAGE_SIZE,
} from "./published-podium-image";

const players = [
  {
    playerId: "first",
    displayName: "A. Madriz",
    average: 8.9,
    rank: 1,
    isMvp: true,
    voteCount: 5,
  },
  {
    playerId: "second",
    displayName: "N. Williams",
    average: 8.6,
    rank: 2,
    isMvp: false,
    voteCount: 5,
  },
  {
    playerId: "third",
    displayName: "D. Sequeira",
    average: 7.6,
    rank: 3,
    isMvp: false,
    voteCount: 5,
  },
];
const podium: PublishedResultPodium = {
  matchId: "synthetic-172",
  homeTeam: { name: "Deportivo Saprissa", externalProviderId: "816" },
  awayTeam: { name: "CS Herediano", externalProviderId: "815" },
  score: { home: 0, away: 2 },
  publishedMatchDate: "2026-11-08T00:00:00Z",
  generatedAt: "2026-11-08T04:00:00Z",
  players,
  topThree: players,
};

async function prepare(bytes: Buffer, mime: string) {
  return loadSocialPlayerPhoto(
    "https://media.api-sports.io/football/players/123.png",
    vi.fn().mockResolvedValue(
      new Response(new Uint8Array(bytes), {
        headers: { "content-type": mime },
      }),
    ),
  );
}

function coloredPixels(
  data: Buffer,
  channels: number,
  color: readonly number[],
) {
  let count = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    if (
      color.every((value, index) => Math.abs(data[offset + index] - value) < 3)
    )
      count++;
  }
  return count;
}

describe("real social portrait rendering", () => {
  it("reproduces the pre-fix MIME failure as transparent output", async () => {
    const jpeg = await sharp({
      create: { width: 150, height: 150, channels: 3, background: "#e04020" },
    })
      .jpeg()
      .toBuffer();
    for (const [mime, visible] of [
      ["image/png", false],
      ["image/jpeg", true],
    ] as const) {
      const output = new ImageResponse(
        <img
          alt=""
          src={`data:${mime};base64,${jpeg.toString("base64")}`}
          width={150}
          height={150}
        />,
        { width: 150, height: 150 },
      );
      const { data, info } = await sharp(
        Buffer.from(await output.arrayBuffer()),
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(
        coloredPixels(data, info.channels, [224, 64, 32, 255]) > 20000,
      ).toBe(visible);
      if (!visible)
        expect(coloredPixels(data, info.channels, [0, 0, 0, 0])).toBe(22500);
    }
  });
  it.each(
    (["herediano", "saprissa"] as const).flatMap((slug) =>
      (["story", "open-graph"] as const).flatMap((variant) =>
        (["valid", "missing", "invalid", "renderer-failure"] as const).map(
          (scenario) => [slug, variant, scenario] as const,
        ),
      ),
    ),
  )(
    "paints portraits or visible initials in %s %s: %s",
    async (slug, variant, scenario) => {
      const size =
        variant === "story" ? STORY_IMAGE_SIZE : OPEN_GRAPH_IMAGE_SIZE;
      const colors = [
        [224, 64, 32],
        [32, 160, 224],
        [48, 208, 80],
      ] as const;
      const photos = new Map<string, string>();
      for (const [index, player] of players.entries()) {
        const image = sharp({
          create: {
            width: 150,
            height: 150,
            channels: 3,
            background: {
              r: colors[index][0],
              g: colors[index][1],
              b: colors[index][2],
            },
          },
        });
        const bytes =
          index === 2
            ? await image.png().toBuffer()
            : await image.jpeg().toBuffer();
        photos.set(
          player.playerId,
          (await prepare(bytes, index === 1 ? "image/png" : "image/jpeg"))!,
        );
      }
      async function render(map: ReadonlyMap<string, string>) {
        const response = new ImageResponse(
          <PublishedPodiumImage
            club={clubs[slug]}
            podium={podium}
            variant={variant}
            photoDataUrls={map}
            siteHost="www.futratecr.com"
            locale="es"
            messages={esMessages.results.image}
          />,
          size,
        );
        return Buffer.from(await response.arrayBuffer());
      }
      if (scenario !== "valid") photos.delete("second");
      if (scenario === "invalid") {
        const corrupt = await prepare(Buffer.from("corrupt"), "image/png");
        expect(corrupt).toBeNull();
        if (corrupt) photos.set("second", corrupt);
      }
      if (scenario === "renderer-failure") {
        // Exercise failure after preparation, without browser onError events.
        photos.set(
          "second",
          photos.get("first")!.replace("image/jpeg", "image/png"),
        );
      }
      const output = await render(photos);
      const { data, info } = await sharp(output)
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect({ width: info.width, height: info.height }).toEqual(size);
      for (const [index, color] of colors.entries()) {
        if (index === 1 && scenario !== "valid") continue;
        expect(coloredPixels(data, info.channels, color)).toBeGreaterThan(
          10000,
        );
      }
      const left =
        variant === "story"
          ? { left: 110, top: 1130, width: 200, height: 100 }
          : { left: 225, top: 290, width: 180, height: 60 };
      if (scenario !== "valid") {
        const region = await sharp(output)
          .extract(left)
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect(
          coloredPixels(region.data, region.info.channels, [201, 205, 211]),
        ).toBeGreaterThan(100);
      }
      await mkdir("test-results/issue-172", { recursive: true });
      await writeFile(
        `test-results/issue-172/${slug}-${variant}-${scenario}.png`,
        output,
      );
    },
    15000,
  );
});
