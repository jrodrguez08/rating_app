import { createHash, timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(
  authorization: string | null,
  secret: string,
): boolean {
  if (secret.trim() === "") return false;
  const expected = digest(`Bearer ${secret}`);
  const actual = digest(authorization ?? "");
  return timingSafeEqual(expected, actual);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}
