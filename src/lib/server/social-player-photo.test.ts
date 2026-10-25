import { describe, expect, it, vi } from "vitest";

import { loadSocialPlayerPhoto } from "./social-player-photo";

describe("social player photo loading", () => {
  it("loads only the allowlisted API-Sports image host", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      loadSocialPlayerPhoto(
        "https://media.api-sports.io/football/players/123.png",
        fetcher,
      ),
    ).resolves.toBe("data:image/png;base64,iVBORw==");
    expect(fetcher).toHaveBeenCalledWith(
      "https://media.api-sports.io/football/players/123.png",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each([
    "http://media.api-sports.io/football/players/123.png",
    "https://example.com/football/players/123.png",
    "https://media.api-sports.io/private/123.png",
  ])("does not request an untrusted photo URL: %s", async (url) => {
    const fetcher = vi.fn();
    await expect(loadSocialPlayerPhoto(url, fetcher)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back when the remote image fails or has an unsafe response", async () => {
    const url = "https://media.api-sports.io/football/players/123.png";
    await expect(
      loadSocialPlayerPhoto(
        url,
        vi.fn().mockResolvedValue(
          new Response("html", {
            headers: { "content-type": "text/html" },
          }),
        ),
      ),
    ).resolves.toBeNull();
    await expect(
      loadSocialPlayerPhoto(
        url,
        vi.fn().mockRejectedValue(new Error("network")),
      ),
    ).resolves.toBeNull();
  });
});
