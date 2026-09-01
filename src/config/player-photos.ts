export const PLAYER_PHOTO_HOST = "media.api-sports.io";
export const PLAYER_PHOTO_PATHNAME = "/football/players/**";

export function isPlayerPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === PLAYER_PHOTO_HOST &&
      /^\/football\/players\/\d+\.png$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
