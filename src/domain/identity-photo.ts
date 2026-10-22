export function missingCanonicalPhotoUrl(
  canonical: { photoUrl?: string },
  duplicate: { photoUrl?: string },
): string | undefined {
  return canonical.photoUrl === undefined ? duplicate.photoUrl : undefined;
}
