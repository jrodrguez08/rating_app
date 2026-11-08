// @vitest-environment node

import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  loadSocialPlayerPhoto,
  loadSocialPlayerPhotos,
} from "./social-player-photo";

const url = "https://media.api-sports.io/football/players/123.png";
let jpeg: Buffer;
let png: Buffer;
beforeAll(async () => {
  const image = sharp({
    create: { width: 150, height: 150, channels: 3, background: "#e04020" },
  });
  jpeg = await image.clone().jpeg().toBuffer();
  png = await image.clone().png().toBuffer();
});
function response(bytes: Uint8Array | string, mime = "image/png") {
  return new Response(
    typeof bytes === "string" ? bytes : new Uint8Array(bytes),
    { headers: { "content-type": mime } },
  );
}
describe("social player photo loading", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["jpeg", "image/png"],
    ["png", "image/png"],
    ["png", "image/jpeg"],
  ] as const)(
    "validates %s bytes advertised as %s at a .png URL",
    async (format, mime) => {
      const bytes = format === "jpeg" ? jpeg : png;
      const fetcher = vi.fn().mockResolvedValue(response(bytes, mime));
      await expect(loadSocialPlayerPhoto(url, fetcher)).resolves.toBe(
        `data:image/${format};base64,${bytes.toString("base64")}`,
      );
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          redirect: "error",
          cache: "force-cache",
          signal: expect.any(AbortSignal),
        }),
      );
    },
  );
  it.each([
    undefined,
    "http://media.api-sports.io/football/players/123.png",
    "https://example.com/football/players/123.png",
    "https://media.api-sports.io/private/123.png",
  ])("does not fetch untrusted or absent URL %s", async (value) => {
    const fetcher = vi.fn();
    await expect(loadSocialPlayerPhoto(value, fetcher)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects malformed payloads, including headers that still parse as metadata", async () => {
    const webp = await sharp(png).webp().toBuffer();
    for (const bytes of [
      new Uint8Array(),
      jpeg.subarray(0, -20),
      png.subarray(0, -20),
      Buffer.from([137, 80, 78, 71]),
      webp,
      "<html>error</html>",
      '{"error":true}',
      "not an image",
    ]) {
      await expect(
        loadSocialPlayerPhoto(url, vi.fn().mockResolvedValue(response(bytes))),
      ).resolves.toBeNull();
    }
  });
  it("rejects HTTP failures and nonimage declarations", async () => {
    for (const value of [
      new Response(null, { status: 503 }),
      response(png, "text/html"),
      new Response(null),
    ]) {
      await expect(
        loadSocialPlayerPhoto(url, vi.fn().mockResolvedValue(value)),
      ).resolves.toBeNull();
    }
  });
  it("bounds declared and streamed length and cancels excess downloads", async () => {
    const cancel = vi.fn();
    const oversized = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
        },
        cancel,
      }),
      { headers: { "content-type": "image/png" } },
    );
    await expect(
      loadSocialPlayerPhoto(url, vi.fn().mockResolvedValue(oversized)),
    ).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    const declared = response(png);
    declared.headers.set("content-length", String(2 * 1024 * 1024 + 1));
    const read = vi.spyOn(declared.body!, "getReader");
    await expect(
      loadSocialPlayerPhoto(url, vi.fn().mockResolvedValue(declared)),
    ).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects excessive decoded dimensions", async () => {
    const large = await sharp({
      create: { width: 2001, height: 2000, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await expect(
      loadSocialPlayerPhoto(url, vi.fn().mockResolvedValue(response(large))),
    ).resolves.toBeNull();
  });
  it("uses the three-second abort signal and falls back on timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, options) => {
        const signal = options!.signal!;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      });
    try {
      await expect(loadSocialPlayerPhoto(url, fetcher)).resolves.toBeNull();
      expect(timeout).toHaveBeenCalledWith(3000);
    } finally {
      timeout.mockRestore();
    }
  });
  it("omits unusable photos from the shared renderer map", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("corrupt")));
    try {
      await expect(
        loadSocialPlayerPhotos([
          {
            playerId: "p1",
            displayName: "N. Williams",
            rank: 2,
            average: 8.6,
            voteCount: 5,
            isMvp: false,
            photoUrl: url,
          },
        ]),
      ).resolves.toEqual(new Map());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
