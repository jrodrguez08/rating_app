import sharp from "sharp";

import type { PublishedPodiumPlayer } from "@/application/published-result-podium";
import { isPlayerPhotoUrl } from "@/config/player-photos";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_PHOTO_PIXELS = 4_000_000;

export async function loadSocialPlayerPhoto(
  photoUrl: string | undefined,
  fetchImplementation: typeof fetch = fetch,
): Promise<string | null> {
  if (photoUrl === undefined || !isPlayerPhotoUrl(photoUrl)) return null;
  try {
    const response = await fetchImplementation(photoUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
      cache: "force-cache",
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (contentType !== "image/png" && contentType !== "image/jpeg") {
      return null;
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PHOTO_BYTES) {
      return null;
    }
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_PHOTO_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (length === 0) return null;
    const bytes = Buffer.concat(chunks, length);
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_PHOTO_PIXELS,
    });
    const { format } = await image.metadata();
    if (format !== "png" && format !== "jpeg") return null;
    // Metadata alone accepts truncated payloads. Force a complete decode before
    // passing the original, correctly labeled bytes to ImageResponse.
    await image.raw().toBuffer();
    return `data:image/${format};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function loadSocialPlayerPhotos(
  players: readonly PublishedPodiumPlayer[],
): Promise<ReadonlyMap<string, string>> {
  const photos = await Promise.all(
    players.map(
      async (player) =>
        [
          player.playerId,
          await loadSocialPlayerPhoto(player.photoUrl),
        ] as const,
    ),
  );
  return new Map(
    photos.filter(
      (entry): entry is readonly [string, string] => entry[1] !== null,
    ),
  );
}
