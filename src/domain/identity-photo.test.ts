import { describe, expect, it } from "vitest";

import { missingCanonicalPhotoUrl } from "./identity-photo";

describe.each(["Player", "Coach"])("%s identity photo fallback", () => {
  it.each([
    {
      canonical: undefined,
      duplicate: "https://images.test/duplicate.png",
      expected: "https://images.test/duplicate.png",
    },
    {
      canonical: "https://images.test/canonical.png",
      duplicate: "https://images.test/duplicate.png",
      expected: undefined,
    },
    { canonical: undefined, duplicate: undefined, expected: undefined },
    {
      canonical: "https://images.test/canonical.png",
      duplicate: undefined,
      expected: undefined,
    },
  ])(
    "returns only a missing canonical photo fallback",
    ({ canonical, duplicate, expected }) => {
      expect(
        missingCanonicalPhotoUrl(
          canonical === undefined ? {} : { photoUrl: canonical },
          duplicate === undefined ? {} : { photoUrl: duplicate },
        ),
      ).toBe(expected);
    },
  );
});
