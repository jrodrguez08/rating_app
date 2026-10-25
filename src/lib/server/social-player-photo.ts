import type { PublishedPodiumPlayer } from "@/application/published-result-podium";
import { isPlayerPhotoUrl } from "@/config/player-photos";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

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
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) {
      return null;
    }
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
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
